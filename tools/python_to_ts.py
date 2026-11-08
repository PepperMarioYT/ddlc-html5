"""Compile the Python subset used by Ren'Py scripts into TypeScript closures."""
import ast
import json
import textwrap

def literal(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'))

class Unsupported(Exception):
    pass

class Compiler:
    binary = {'Add': '+', 'Sub': '-', 'Mult': '*', 'Div': '/', 'Mod': '%',
              'FloorDiv': '//', 'Pow': '**'}
    comparison = {'Eq': '==', 'NotEq': '!=', 'Gt': '>', 'GtE': '>=', 'Lt': '<',
                  'LtE': '<=', 'In': 'in', 'NotIn': 'not in', 'Is': 'is', 'IsNot': 'is not'}

    def expression(self, node):
        e = self.expression
        match node:
            case ast.Constant(value=value):
                return literal(value)
            case ast.Name(id=name):
                return f'p.get({literal(name)})'
            case ast.Attribute(value=value, attr=name):
                return f'p.attr({e(value)}, {literal(name)})'
            case ast.Subscript(value=value, slice=ast.Slice(lower=low, upper=high, step=None)):
                return f'p.slice({e(value)}, {e(low) if low else "null"}, {e(high) if high else "null"})'
            case ast.Subscript(value=value, slice=index):
                return f'p.item({e(value)}, {e(index)})'
            case ast.List(elts=items) | ast.Tuple(elts=items) | ast.Set(elts=items):
                return '[' + ','.join(map(e, items)) + ']'
            case ast.Dict(keys=keys, values=values) if all(keys):
                return '({' + ','.join(f'[{e(k)}]:{e(v)}' for k, v in zip(keys, values)) + '})'
            case ast.Call(func=func, args=args, keywords=keywords):
                parts = ','.join('...' + e(arg.value) if isinstance(arg, ast.Starred) else e(arg) for arg in args)
                kwargs = ','.join(f'{literal(k.arg)}:{e(k.value)}' if k.arg else '...' + e(k.value) for k in keywords)
                return f'await p.call({e(func)}, [{parts}], {{{kwargs}}})'
            case ast.UnaryOp(op=ast.Not(), operand=value):
                return f'!p.truth({e(value)})'
            case ast.UnaryOp(op=ast.USub(), operand=value):
                return f'(-{e(value)})'
            case ast.BinOp(left=left, op=op, right=right) if type(op).__name__ in self.binary:
                return f'p.binary({literal(self.binary[type(op).__name__])}, {e(left)}, {e(right)})'
            case ast.Compare(left=left, ops=ops, comparators=right):
                operators = literal([self.comparison[type(op).__name__] for op in ops])
                return f'await p.compare({operators}, [{",".join("async () => "+e(x) for x in [left, *right])}])'
            case ast.BoolOp(op=op, values=values):
                return f'await p.boolean({str(isinstance(op, ast.And)).lower()}, [{",".join("async () => "+e(x) for x in values)}])'
            case ast.IfExp(test=test, body=yes, orelse=no):
                return f'(p.truth({e(test)}) ? {e(yes)} : {e(no)})'
            case ast.GeneratorExp(elt=value, generators=[gen]) if not gen.is_async:
                guard = ' && '.join(f'p.truth({e(test)})' for test in gen.ifs) or 'true'
                return f'await p.generate({e(gen.iter)}, async (p, v) => {{ {self.assign(gen.target, "v")} return {guard} ? [{e(value)}] : []; }})'
            case _:
                raise Unsupported(type(node).__name__)

    def assign(self, node, value):
        match node:
            case ast.Name(id=name):
                return f'p.set({literal(name)}, {value});'
            case ast.Attribute(value=owner, attr=name):
                return f'p.put({self.expression(owner)}, {literal(name)}, {value});'
            case ast.Subscript(value=owner, slice=ast.Slice(lower=low, upper=high, step=None)):
                return f'p.replaceSlice({self.expression(owner)}, {self.expression(low) if low else "null"}, {self.expression(high) if high else "null"}, {value});'
            case ast.Subscript(value=owner, slice=index):
                return f'p.put({self.expression(owner)}, {self.expression(index)}, {value});'
            case ast.Tuple(elts=items) | ast.List(elts=items):
                return '{ const unpacked: Value = ' + value + '; ' + ''.join(
                    self.assign(item, f'unpacked[{index}]') for index, item in enumerate(items)) + '}'
            case _:
                raise Unsupported(type(node).__name__)

    def block(self, nodes):
        return '\n'.join(map(self.statement, nodes))

    def statement(self, node):
        e = self.expression
        b = self.block
        match node:
            case ast.Expr(value=value):
                return e(value) + ';'
            case ast.Assign(targets=targets, value=value):
                return '{ const value: Value = ' + e(value) + '; ' + ''.join(self.assign(t, 'value') for t in targets) + '}'
            case ast.AugAssign(target=target, op=op, value=value):
                return self.assign(target, f'p.binary({literal(self.binary[type(op).__name__])}, {e(target)}, {e(value)})')
            case ast.If(test=test, body=yes, orelse=no):
                return f'if (p.truth({e(test)})) {{ {b(yes)} }} else {{ {b(no)} }}'
            case ast.For(target=target, iter=items, body=body, orelse=[]):
                return f'for (const item of {e(items)}) {{ {self.assign(target, "item")} {b(body)} }}'
            case ast.While(test=test, body=body, orelse=[]):
                return f'while (p.truth({e(test)})) {{ p.tick(); {b(body)} }}'
            case ast.Try(body=body, handlers=[handler], orelse=[], finalbody=[]) if not handler.type and not handler.name:
                return f'try {{ {b(body)} }} catch (error) {{ p.catchError(error); {b(handler.body)} }}'
            case ast.FunctionDef(name=name):
                return f'p.set({literal(name)}, {self.function(node)});'
            case ast.ClassDef(name=name, bases=bases, body=methods, decorator_list=[], keywords=[]):
                entries = ','.join(f'{literal(m.name)}:{self.function(m)}' for m in methods if isinstance(m, ast.FunctionDef))
                if any(not isinstance(m, ast.FunctionDef) for m in methods):
                    raise Unsupported('class member')
                return f'p.set({literal(name)}, p.makeClass({e(bases[0]) if bases else "null"}, {{{entries}}}));'
            case ast.Import(names=names):
                return ''.join(f'p.importModule({literal(n.name)}, {literal(n.asname or n.name)});' for n in names)
            case ast.Return(value=value):
                return 'return ' + (e(value) if value else 'null') + ';'
            case ast.Delete(targets=targets):
                parts = []
                for target in targets:
                    match target:
                        case ast.Name(id=name):
                            parts.append(f'p.unset({literal(name)});')
                        case ast.Attribute(value=value, attr=attr):
                            parts.append(f'p.remove({e(value)}, {literal(attr)});')
                        case ast.Subscript(value=value, slice=ast.Slice(lower=low, upper=high, step=None)):
                            parts.append(f'p.replaceSlice({e(value)}, {e(low) if low else "null"}, {e(high) if high else "null"}, []);')
                        case ast.Subscript(value=value, slice=index):
                            parts.append(f'p.remove({e(value)}, {e(index)});')
                        case _:
                            raise Unsupported('delete target')
                return ''.join(parts)
            case ast.With(items=[item], body=body) if item.optional_vars:
                return f'{{ const resource = {e(item.context_expr)}; {self.assign(item.optional_vars, "resource")} try {{ {b(body)} }} finally {{ p.close(resource); }} }}'
            case ast.Global() | ast.Pass():
                return ''
            case ast.Break():
                return 'break;'
            case ast.Continue():
                return 'continue;'
            case _:
                return self.unsupported(node)

    def function(self, node):
        args = node.args
        if node.decorator_list or args.posonlyargs or args.vararg or args.kwonlyargs:
            raise Unsupported('function signature')
        names = [arg.arg for arg in args.args]
        defaults = ','.join(map(self.expression, args.defaults))
        globals_ = sorted({name for statement in ast.walk(node) if isinstance(statement, ast.Global) for name in statement.names})
        kwargs = literal(args.kwarg.arg if args.kwarg else None)
        return f'p.functionOf({literal(names)}, [{defaults}], {literal(globals_)}, {kwargs}, async (p) => {{ {self.block(node.body)} }})'

    def unsupported(self, node):
        raise Unsupported(type(node).__name__)

    def compile(self, source, mode):
        tree = ast.parse(textwrap.dedent(source).strip(), mode=mode)
        return f'return {self.expression(tree.body)};' if mode == 'eval' else self.block(tree.body)
