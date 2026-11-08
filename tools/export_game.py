"""Export Ren'Py bytecode records as a browser program and compiled TypeScript."""
from pathlib import Path
from collections import Counter
import ast
import io
import tokenize
import re
import sys

from read_scene import read
from menu_atl import compile_menu
from python_to_ts import Compiler, Unsupported, literal

root = Path(sys.argv[1]).resolve()
scripts = root / 'original/scripts'
output = Path(sys.argv[2])
compiler = Compiler()
compiled = {}
issues = Counter()

def code(source, mode, location):
    key = (str(source), mode)
    if key not in compiled:
        try:
            compiled[key] = (len(compiled), compiler.compile(*key), None)
        except (Unsupported, SyntaxError, KeyError) as error:
            issues[str(error)] += 1
            compiled[key] = (len(compiled), None, f'{location}: {error}')
    return compiled[key][0]

def where(node):
    return f'{node.filename}:{node.linenumber}'

def node_code(node):
    return code(node.code.raw_state[1], node.code.raw_state[3], where(node))

def label_record(node, body):
    if node.name in labels:
        raise ValueError(f'Duplicate label {node.name}')
    params = node.parameters
    labels[node.name] = {'body':body, 'params':[
        [key,code(val,'eval',where(node)) if val is not None else None]
        for key,val in params.parameters] if params else []}

def instructions(nodes, continuation=()):
    body = []
    for node in reversed(nodes):
        tail = [*body, *continuation]
        if type(node).__name__ == 'Label':
            nested = instructions(node.block, tail)
            label_record(node, [*nested, *tail])
            body = [*nested, *body]
        else:
            instruction = statement(node, tail)
            if instruction is not None:
                body.insert(0, instruction)
    return body

def statement(n, tail):
    kind = type(n).__name__
    loc = where(n)
    def expr(value):
        return code(value, 'eval', loc)
    result = {'at': loc}
    if kind == 'Pass':
        return None
    if kind == 'Say':
        return result | {'op':'say', 'who':n.who, 'text':n.what, 'interact':n.interact}
    if kind in ('Scene', 'Show', 'Hide'):
        spec = n.imspec
        if not spec:
            return result | {'op':kind.lower(), 'layer':getattr(n, 'layer', None)}
        name, expression, tag, positions, layer, order, behind = spec
        return result | {'op':kind.lower(), 'name':' '.join(name or ()), 'tag':tag,
                         'layer':layer, 'order':expr(order) if order is not None else None,
                         'positions':[str(p) for p in positions], 'behind':behind,
                         'expression':expr(expression) if expression is not None else None}
    if kind in ('Python', 'EarlyPython'):
        return result | {'op':'python', 'code':node_code(n)}
    if kind in ('Jump', 'Call'):
        target = n.label if kind == 'Call' else n.target
        args = getattr(n, 'arguments', None)
        return result | {'op':kind.lower(), 'target':str(target),
                         'expression':expr(target) if n.expression else None,
                         'args':[[name, expr(value)] for name,value in args.arguments] if args else []}
    if kind == 'Return':
        return result | {'op':'return', 'expression':expr(n.expression) if n.expression is not None else None}
    if kind == 'If':
        return result | {'op':'if', 'branches':[[expr(test), instructions(body, tail)] for test,body in n.entries]}
    if kind == 'Menu':
        return result | {'op':'menu', 'choices':[
            {'text':text, 'condition':expr(test), 'body':instructions(body, tail) if body is not None else None}
            for text,test,body in n.items]}
    if kind == 'With':
        return result | {'op':'with', 'name':str(n.expr)}
    if kind == 'UserStatement':
        parts = n.line.split(maxsplit=2)
        if parts[0] in ('play','queue','stop') and len(parts) >= 2:
            audio = parts[2] if len(parts)>2 else ''
            track = audio
            depth = 0
            options = {}
            tokens = list(tokenize.generate_tokens(io.StringIO(audio).readline))
            for index, token in enumerate(tokens):
                if token.type == tokenize.OP and token.string in ('[','(','{'):
                    depth += 1
                elif token.type == tokenize.OP and token.string in (']',')','}'):
                    depth -= 1
                elif not depth and token.type == tokenize.NAME and token.string in ('fadein','fadeout','loop','noloop','if_changed'):
                    track = audio[:token.start[1]].rstrip()
                    for i in range(index, len(tokens)):
                        option = tokens[i].string
                        if option in ('fadein', 'fadeout') and i + 1 < len(tokens) and tokens[i + 1].type == tokenize.NUMBER:
                            options[option] = float(tokens[i + 1].string)
                        elif option in ('loop', 'noloop'):
                            options['loop'] = option == 'loop'
                        elif option == 'if_changed':
                            options['ifChanged'] = True
                    break
            return result | {'op':'audio', 'action':parts[0], 'channel':parts[1],
                             'expression':expr(track) if parts[0]!='stop' and track else None, 'audioOptions':options}
        if n.line.startswith('call screen '):
            return result | {'op':'call-screen', 'expression':expr(parts[2])}
        if n.line.startswith(('show screen ', 'hide screen ')):
            name, _, arguments = parts[2].partition('(')
            return result | {'op':'screen', 'action':parts[0], 'name':name,
                             'expression':expr('__screen_args(' + arguments) if arguments else None}
        if parts[0] in ('pause','window'):
            return result | {'op':parts[0], 'name':parts[1] if len(parts)>1 else ''}
    if kind == 'ShowLayer':
        return result | {'op':'layer', 'layer':n.layer}
    return result | {'op':'unsupported', 'name':getattr(n,'line',kind)}

def transform(n):
    params = {name: value for name,value in n.parameters.parameters} if n.parameters else {}
    props = {}
    alias = None
    def walk(block):
        nonlocal alias
        for item in block.statements:
            for name, value in getattr(item, 'properties', []):
                if name in ('xcenter', 'xpos', 'ypos', 'yalign', 'zoom', 'alpha'):
                    props[name] = str(value)
            for value, _ in getattr(item, 'expressions', []):
                if re.fullmatch(r'[a-zA-Z_]\w*\([0-9., ]*\)', value):
                    call = ast.parse(value, mode='eval').body
                    alias = [call.func.id, [ast.literal_eval(arg) for arg in call.args]]
            if 'show' in getattr(item, 'handlers', {}):
                walk(item.handlers['show'])
    walk(n.atl)
    vertical = []
    for item in n.atl.statements:
        offset = dict(getattr(item, 'properties', [])).get('yoffset')
        duration = getattr(item, 'duration', None)
        if offset is not None and duration is not None and all(re.fullmatch(r'-?[0-9.]+', value) for value in (duration, offset)):
            vertical.append([float(duration), float(offset)])
    return {'params':params, 'properties':props, 'alias':alias, 'vertical':vertical}

def screen_tree(node, location):
    kind = type(node).__name__
    result = {'kind':kind}
    if getattr(node, 'children', None):
        result['children'] = [screen_tree(child, location) for child in node.children]
    if kind == 'SLIf':
        result['branches'] = [[code(test,'eval',location) if test is not None else None,
                               screen_tree(branch, location)] for test, branch in node.entries]
    if kind in ('SLDefault','SLFor'):
        result['variable'] = node.variable
        result['expression'] = code(node.expression, 'eval', location)
    if kind == 'SLUse':
        if node.block:
            result['content'] = screen_tree(node.block, location)
        result['target'] = node.target
        result['bindings'] = [[key,code(value,'eval',location)] for key,value in node.args.arguments] if node.args else []
    if kind == 'SLPython':
        result['code'] = code(node.code.source if hasattr(node.code, 'source') else node.code.raw_state[1], 'exec', location)
    if kind == 'SLDisplayable':
        result['style'] = node.style
        result['args'] = [code(source, 'eval', location) for source in node.positional]
    if getattr(node, 'keyword', None):
        result['properties'] = {name:code(source, 'eval', location) for name,source in node.keyword}
    return result

labels = {}
images = {}
transforms = {}
styles = set()
screens = {}
image_layouts = {}
image_colors = {}
atl_images = {}
atl_transforms = {}
title_music = {}
startup = {}
style_properties = {}
bootstrap = []
before_start = []
inits = []
files = {path.name:path.read_text(errors='replace') for path in scripts.glob('*.txt')}
file_names = [path.name for path in scripts.iterdir() if path.suffix != '.rpyc']
image_root = root / 'original/images'
files.update({asset.name: asset.relative_to(root).as_posix() for asset in image_root.iterdir() if asset.is_file()})
file_names.extend(name for name in files if name not in file_names)
for path in sorted(scripts.glob('*.rpyc')):
    def collect(nodes, priority=0):
        for index, n in enumerate(nodes):
            kind = type(n).__name__
            if kind == 'Label':
                following = nodes[index + 1] if index + 1 < len(nodes) else None
                continuation = ([{'op':'jump','at':where(following),'target':following.name}]
                                if type(following).__name__ == 'Label' else [])
                label_record(n, [*instructions(n.block, continuation), *continuation])
                if n.name == 'splashscreen':
                    for child in n.block:
                        if type(child).__name__ == 'If':
                            condition = str(child.entries[0][0])
                            if condition == 'not persistent.first_run':
                                first_run = child.entries[0][1]
                                pictures = [step.imspec[0][0] for step in first_run
                                            if type(step).__name__ == 'Scene' and step.imspec[0][0] != 'white']
                                acknowledgement = next(step for step in first_run if type(step).__name__ == 'Menu')
                                startup['consent'] = {
                                    'background':pictures[0], 'acceptedBackground':pictures[1],
                                    'warnings':[step.what for step in first_run if type(step).__name__ == 'Say'],
                                    'statement':next(text for text,_,body in acknowledgement.items if body is None),
                                    'accept':next(text for text,_,body in acknowledgement.items if body is not None),
                                }
                            if 'not persistent.seen_ghost_menu' in condition:
                                title_music['ghostCondition'] = code(condition, 'eval', where(child))
                                for step in child.entries[0][1]:
                                    if type(step).__name__ == 'Python':
                                        source = step.code.raw_state[1].strip()
                                        if source.startswith('config.main_menu_music = '):
                                            title_music['ghost'] = code(source.split(' = ', 1)[1], 'eval', where(step))
                            if condition == 'not persistent.special_poems':
                                bootstrap.extend(instructions([child]))
                            elif condition == 's_kill_early':
                                before_start.extend(instructions([child]))
                        elif type(child).__name__ == 'Python' and child.code.raw_state[1].strip().startswith('s_kill_early ='):
                            before_start.extend(instructions([child]))
                    for index, step in enumerate(n.block):
                        if type(step).__name__ != 'Show' or step.imspec[0][0] not in ('intro', 'splash_warning'):
                            continue
                        name = step.imspec[0][0]
                        deadline = next(candidate for candidate in n.block[index + 1:]
                                        if type(candidate).__name__ == 'Python'
                                        and candidate.code.raw_state[1].strip().startswith('pause('))
                        call = ast.parse(deadline.code.raw_state[1].strip(), mode='eval').body
                        startup[name] = {'end':ast.literal_eval(call.args[0].left)}
                    startup['splash_warning']['message'] = code('splash_message_default','eval',where(n))
            elif kind == 'Style':
                styles.add(n.style_name)
                style_properties.setdefault(n.style_name, {}).update({
                    name:code(value,'eval',where(n)) for name,value in n.properties.items()})
            elif kind == 'Screen':
                variants = screens.setdefault(n.screen.name, [])
                variants.append(screen_tree(n.screen, where(n)))
            elif kind == 'Init':
                collect(n.block, n.priority)
            elif kind in ('Define','Default','Python','EarlyPython'):
                target = None
                if kind in ('Python', 'EarlyPython') and 'class ParticleBurst' in n.code.raw_state[1]:
                    tree = ast.parse(n.code.raw_state[1].strip())
                    particle = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'ParticleBurst')
                    setup = next(node for node in particle.body if isinstance(node, ast.FunctionDef) and node.name == '__init__')
                    for statement in setup.body:
                        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Attribute) and t.attr == 'gravity' for t in statement.targets):
                            atl_transforms['__particle_defaults__'] = {'gravity': ast.literal_eval(statement.value)}
                if kind in ('Define','Default'):
                    target = '.'.join(filter(None,[n.store.removeprefix('store').lstrip('.'), n.varname]))
                inits.append([priority, where(n), kind, target, node_code(n)])
            elif kind == 'Transform':
                transforms[n.varname] = transform(n)
                atl_transforms[n.varname] = n
            elif kind == 'Image':
                if getattr(n, 'atl', None):
                    atl_images[' '.join(n.imgname)] = n
                image_code = getattr(n, 'code', None)
                if image_code:
                    source = image_code.raw_state[1]
                    if re.fullmatch(r'#[0-9a-fA-F]{3,8}', source[1:-1]):
                        image_colors[' '.join(n.imgname)] = source[1:-1]
                else:
                    source = next((str(value) for item in getattr(getattr(n, 'atl', None), 'statements', [])
                                   for value, _ in getattr(item, 'expressions', [])
                                   if re.match(r'^["\'].*\.(png|jpe?g)["\']$', value, re.I)), '')
                paths = re.findall(r'["\']([^"\']+\.(?:png|jpe?g|webp))["\']', source, re.I)
                if not paths or not (source.startswith(('"', "'", 'im.Composite(', 'Composite('))):
                    continue
                layers = []
                for asset in paths:
                    options = [image_root / asset, image_root / 'images' / asset]
                    existing = next((p for p in options if p.is_file()), None)
                    if existing:
                        layers.append(existing.relative_to(root).as_posix())
                if len(layers) == len(paths):
                    name = ' '.join(n.imgname)
                    images[name] = layers
                    layout = {}
                    for item in getattr(getattr(n, 'atl', None), 'statements', []):
                        for key, value in getattr(item, 'properties', []):
                            if key in ('xcenter','ycenter','zoom','xpos','ypos') and re.fullmatch(r'-?[0-9.]+', value):
                                layout[key] = float(value)
                    if layout:
                        image_layouts[name] = layout
    collect(read(path))

output.mkdir(parents=True, exist_ok=True)
program = {'entry':'start','labels':labels,'images':images,'transforms':transforms,
           'bootstrap':bootstrap,'beforeStart':before_start,'styles':sorted(styles),'screens':screens,'startup':startup,'imageLayouts':image_layouts,'imageColors':image_colors,'titleAtl':compile_menu(atl_images, atl_transforms),'titleMusic':title_music,'styleProperties':style_properties,
           'initializers':[i[1:] for i in sorted(inits,key=lambda i:i[0])],
           'files':files,'fileNames':file_names, 'audioRoot':'original/audio/',
           'assets':{p.relative_to(image_root).as_posix():p.relative_to(root).as_posix()
                     for p in image_root.rglob('*') if p.is_file()}}
with (output / 'game.generated.ts').open('w') as f:
    f.write('// Generated from the local Ren’Py archives by tools/export_game.py.\n')
    f.write('namespace WebVN {\n')
    f.write('export const game: Program = JSON.parse(' + literal(literal(program)) + ');\n')
    f.write('export const gameCode: readonly PythonCode[] = [\n')
    for _, body, error in compiled.values():
        f.write('async (p) => {\n' + (body if error is None else f'p.unsupported({literal(error)});') + '\n},\n')
    f.write('];\n}\n')
print(f'{len(screens)} screens, {len(labels)} labels, {len(images)} image definitions, {len(compiled)} Python units ({sum(issues.values())} unsupported)')
print(dict(issues))
