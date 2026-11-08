"""Extract the base game's RPA archives into the browser port's asset folders."""

import argparse
import io
from pathlib import Path
import pickle
import shutil
import tempfile
import zlib


class ArchiveIndex(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"Unexpected archive index class {module}.{name}")


def unpack_archive(archive, destination):
    with archive.open("rb") as stream:
        version, offset, key = stream.readline().split()
        if version != b"RPA-3.0":
            raise ValueError(f"{archive.name}: expected an RPA-3.0 archive")
        index_offset = int(offset, 16)
        stream.seek(index_offset)
        index = ArchiveIndex(io.BytesIO(zlib.decompress(stream.read())), encoding="bytes").load()
        key = int(key, 16)
        root = destination.resolve()
        for name, chunks in index.items():
            relative = Path(name.decode("utf-8") if isinstance(name, bytes) else name)
            target = (root / relative).resolve()
            if not target.is_relative_to(root) or target == root:
                raise ValueError(f"Invalid archive path: {relative}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                for offset, length, *prefix in chunks:
                    offset ^= key
                    length ^= key
                    if offset < 0 or length < 0 or offset + length > index_offset:
                        raise ValueError(f"Invalid archive entry: {relative}")
                    stream.seek(offset)
                    data = stream.read(length)
                    if len(data) != length:
                        raise ValueError(f"Truncated archive entry: {relative}")
                    if prefix:
                        output.write(prefix[0])
                    output.write(data)
        print(f"{archive.name}: {len(index)} files")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("install", type=Path, help="DDLC installation directory containing game/ and README.html")
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()

    archives = [args.install / "game" / f"{name}.rpa" for name in ("audio", "fonts", "images", "scripts")]
    help_file = args.install / "README.html"
    for path in [*archives, help_file]:
        if not path.is_file():
            parser.error(f"Required game file missing: {path}")

    destination = args.project / "original"
    if destination.exists():
        parser.error(f"{destination} already exists. Move it aside before extracting again.")

    with tempfile.TemporaryDirectory(prefix=".ddlc-extract-", dir=args.project) as staging:
        extracted = Path(staging) / "original"
        for archive in archives:
            unpack_archive(archive, extracted / archive.stem)
        shutil.copyfile(help_file, extracted / "README.html")
        extracted.rename(destination)


if __name__ == "__main__":
    main()
