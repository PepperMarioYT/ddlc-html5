import io, pickle, struct, zlib, sys
from pathlib import Path

class Record:
    def __new__(cls, *args):
        instance = object.__new__(cls)
        instance.args = args
        return instance
    def __setstate__(self, state):
        self.raw_state = state
        if isinstance(state, tuple):
            for part in state:
                if isinstance(part, dict):
                    self.__dict__.update(part)
        elif isinstance(state, dict):
            self.__dict__.update(state)
        else:
            self.state = state
    def __repr__(self):
        return f"{type(self).__name__}({self.__dict__!r})"

class Expr(str):
    def __new__(cls, value, *args):
        return str.__new__(cls, value)

class Reader(pickle.Unpickler):
    def find_class(self, module, name):
        if module.startswith('renpy.'):
            return Expr if name == 'PyExpr' else type(name, (Record,), {})
        if (module, name) in {('__builtin__', 'set'), ('builtins', 'set')}:
            return set
        raise ValueError((module, name))

def read(file):
    data = Path(file).read_bytes()
    slot, offset, size = struct.unpack_from('<III', data, 10)
    assert slot == 1
    return Reader(io.BytesIO(zlib.decompress(data[offset:offset+size])), encoding='latin1').load()[1]

if __name__ == '__main__':
    for node in read(sys.argv[1])[:int(sys.argv[2])]:
        print(repr(node)[:1400])
