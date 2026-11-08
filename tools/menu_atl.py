"""Lower the title screen's ATL statements into independent animation tracks."""
import ast
import operator

PROPERTIES = {'xoffset', 'yoffset', 'xpos', 'ypos', 'zoom', 'alpha'}
OPERATORS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}

def number(node, values):
    if isinstance(node, str):
        node = ast.parse(node, mode='eval').body
    if isinstance(node, ast.Constant) and type(node.value) in (float, int):
        return node.value
    if isinstance(node, ast.Name):
        return values[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -number(node.operand, values)
    if isinstance(node, ast.BinOp) and type(node.op) in OPERATORS:
        return OPERATORS[type(node.op)](number(node.left, values), number(node.right, values))
    raise ValueError(ast.dump(node))

def compile_menu(images, transforms):
    result = {}
    for name, image in images.items():
        if not name.startswith('menu_'):
            continue
        tracks = []
        particles = None
        displayable = None
        values = {'alpha': 1, 'zoom': 1, 'xoffset': 0, 'yoffset': 0, 'xpos': 0, 'ypos': 0}
        def block(raw, bindings, state, start, output, depth=0):
            nonlocal particles, displayable
            if depth > 12:
                raise ValueError(f'ATL recursion in {name}')
            cursor = start
            repeat = False
            events = {}
            for node in raw.statements:
                kind = type(node).__name__
                if kind == 'RawTime':
                    cursor = max(cursor, start + number(node.time, bindings))
                elif kind == 'RawRepeat':
                    repeat = True
                elif kind == 'RawParallel':
                    ends = []
                    for branch in node.blocks:
                        local = state.copy()
                        ends.append(block(branch, bindings, local, cursor, output, depth + 1))
                        state.update({key: value for key, value in local.items() if value != state.get(key)})
                    cursor = max(ends, default=cursor)
                elif kind == 'RawMultipurpose':
                    duration = number(node.duration, bindings)
                    for prop, value in node.properties:
                        if prop not in PROPERTIES:
                            continue
                        target = number(value, bindings)
                        events.setdefault(prop, []).append([cursor, duration, state[prop], target, node.warper or 'linear'])
                        state[prop] = target
                    cursor += duration
                    for source, _ in node.expressions:
                        expr = ast.parse(source, mode='eval').body
                        if isinstance(expr, ast.Constant) and type(expr.value) in (float, int):
                            cursor += expr.value
                        elif isinstance(expr, ast.Constant) and isinstance(expr.value, str):
                            displayable = expr.value
                        elif isinstance(expr, ast.Attribute) and isinstance(expr.value, ast.Call) and getattr(expr.value.func, 'id', None) == 'ParticleBurst':
                            call = expr.value
                            particles = dict(asset=ast.literal_eval(call.args[0]), start=cursor,
                                             x=state['xpos'], y=state['ypos'])
                            particles.update({kw.arg: ast.literal_eval(kw.value) for kw in call.keywords})
                            particle_def = transforms.get('__particle_defaults__', {})
                            particles.update(particle_def)
                        else:
                            ref = expr.func if isinstance(expr, ast.Call) else expr
                            definition = transforms.get(getattr(ref, 'id', ''))
                            if definition:
                                args = [number(arg, bindings) for arg in expr.args] if isinstance(expr, ast.Call) else []
                                params = getattr(definition, 'parameters', None)
                                local = {}
                                for index, (param, default) in enumerate(params.parameters if params else []):
                                    local[param] = args[index] if index < len(args) else number(default, bindings)
                                # Imported transforms share the same ATL timeline and property state.
                                cursor = block(definition.atl, local, state, cursor, output, depth + 1)
            for prop, segments in events.items():
                output.append(dict(property=prop, segments=segments,
                                   repeat=cursor-start if repeat else None, start=start))
            return start if repeat else cursor

        block(image.atl, {}, values, 0, tracks)
        merged = []
        for prop in PROPERTIES:
            matches = [track for track in tracks if track['property'] == prop]
            segments = sorted((segment for track in matches if track['repeat'] is None
                               for segment in track['segments']), key=lambda segment: segment[0])
            if segments:
                merged.append(dict(property=prop, segments=segments, repeat=None, start=0))
            merged.extend(track for track in matches if track['repeat'] is not None)
        result[name] = dict(tracks=merged, particles=particles, displayable=displayable)
    return result
