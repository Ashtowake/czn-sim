"""Inspect/decompile selected Chaos Zero Nightmare cached runtime modules.

This is a research helper, not part of the web application.  It reads the
installed PLPcK runtime archive and the matching V8 snapshot directly, keeping
the recovered combat behavior reproducible without launching or modifying the
game.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path


DEFAULT_ARCHIVE = Path(
    r"C:\Users\ithur\AppData\Local\Temp\czn-ripper-analysis"
    r"\runtime\bin\x86_64\main.jbin"
)
DEFAULT_EXE = Path(
    r"C:\ProgramData\Smilegate\Games\ChaosZeroNightmare"
    r"\bin\ssr-stove-shield.exe"
)
DEFAULT_V8ASM = Path(r"C:\Users\ithur\AppData\Local\Temp\v8asm")

SNAPSHOT_OFFSET = 0x226ECD8
SNAPSHOT_LENGTH = 0x4871F
V8_VERSION = "12.4.254.21"


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    payload_offset: int
    payload_size: int


def u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def archive_entries(data: bytes) -> dict[str, ArchiveEntry]:
    """Read the runtime archive's contiguous chunk records.

    This archive uses a 5-byte record after its 38-byte header.  Its bucket
    pointers are low-u32/high-byte, unlike the data archive parser whose table
    layout is high-byte/low-u32.  Every chunk's ``data_size`` includes its
    15-byte chunk header, so the complete entry list can be walked without
    depending on hash-chain reachability.
    """
    if data[:5] != b"PLPcK":
        raise ValueError("runtime archive does not start with PLPcK")

    header_size = struct.unpack_from("<H", data, 6)[0]
    entry_count = u32(data, 17)
    table_size_bytes = u32(data, 21)
    table_offset = header_size + 5
    bucket_count = table_size_bytes // 2
    chunk = table_offset + bucket_count * 5
    found: dict[str, ArchiveEntry] = {}
    for index in range(entry_count):
        if chunk + 15 > len(data):
            raise ValueError(f"entry {index} header exceeds archive")
        total_size = u32(data, chunk)
        key_length = data[chunk + 5]
        value_size = u32(data, chunk + 6)
        if (
            total_size < 15 + key_length + value_size
            or chunk + total_size > len(data)
        ):
            raise ValueError(
                f"invalid entry {index} at 0x{chunk:x}: "
                f"total={total_size} key={key_length} value={value_size}"
            )
        key = data[chunk + 15 : chunk + 15 + key_length]
        try:
            name = key.decode("utf-8")
        except UnicodeDecodeError:
            name = ""
        if name.endswith(".js"):
            found[name] = ArchiveEntry(
                name=name,
                payload_offset=chunk + 15 + key_length,
                payload_size=value_size,
            )
        chunk += total_size

    if len(found) < 1000:
        raise ValueError(f"only recovered {len(found)} runtime entries")
    return found


def load_objects(
    module_bytes: bytes, snapshot: bytes, v8asm_path: Path, *, diagnose_false=False
):
    sys.path.insert(0, str(v8asm_path))
    from decompiler.structured import load_structured_objects
    from disassembler.disassembler import (
        _array_metadata,
        _function_infos,
        _handler_entries,
        _smi_lengths,
        decode_instructions,
        parse_disassembly_bytes,
    )
    from disassembler.model import BytecodeArray, ParsedDisassembly
    from disassembler.profiles import load_profiles
    from disassembler.structured import disassembly_to_dict

    parsed = parse_disassembly_bytes(
        module_bytes, version=V8_VERSION, snapshot_blob=snapshot
    )
    document = disassembly_to_dict(parsed)
    # V8 permits valid functions whose final bytecode is a back-edge rather
    # than a terminal instruction (for example, an infinite loop whose exits
    # all return from inside the loop).  v8asm intentionally rejects those as
    # candidates.  Restore only objects independently identified as
    # BytecodeArrays by their serialized map, then validate their complete
    # byte stream and header metadata before adding them to the parse.
    records_by_address = {
        record.get("address"): record for record in document["objects"].values()
    }
    missed_candidates = []
    missed_indices = []
    for key, record in document["objects"].items():
        if record.get("type") == "BytecodeArray" and not isinstance(
            record.get("instructions"), list
        ):
            diagnostic = record.copy()
            diagnostic["referenced_records"] = {
                reference.get("address"): records_by_address.get(reference.get("address"))
                for reference in record.get("serializer", {})
                .get("references", {})
                .values()
            }
            missed_candidates.append(diagnostic)
            address = int(key, 16)
            missed_indices.append((address - 0xF00000000000) // 0x100)

    if missed_indices:
        profiles = load_profiles()
        recovered = list(parsed.arrays)
        for object_index in missed_indices:
            obj = parsed.objects[object_index]
            image, present = obj.image()
            candidates = []
            for length_offset, length in _smi_lengths(
                image, present, parsed.tagged_size
            ):
                if length <= 0 or length > obj.size:
                    continue
                metadata = _array_metadata(
                    obj,
                    list(parsed.objects),
                    parsed.profile,
                    parsed.tagged_size,
                    length_offset,
                )
                if metadata is None:
                    continue
                for padding in range(8):
                    start = obj.size - length - padding
                    if start < 2 * parsed.tagged_size:
                        continue
                    if not all(present[start : start + length]):
                        continue
                    try:
                        instructions = decode_instructions(
                            image[start : start + length],
                            parsed.profile,
                            profiles,
                        )
                    except ValueError:
                        continue
                    # Bytecode headers are pointer-aligned.  Prefer that
                    # independently useful signal if more than one shifted
                    # stream happens to decode by chance.
                    candidates.append(
                        (start % parsed.tagged_size != 0, padding, start, instructions, metadata)
                    )
            if not candidates:
                raise ValueError(
                    f"map-verified BytecodeArray {object_index} has no valid byte stream"
                )
            _, _, start, instructions, metadata = min(candidates)
            (
                parameter_count,
                register_count,
                frame_size,
                constant_pool,
                handler_data,
                source_position_data,
            ) = metadata
            payload_offset = None
            for chunk in obj.raw_chunks:
                if chunk.object_offset <= start < chunk.object_offset + len(chunk.data):
                    payload_offset = chunk.payload_offset + start - chunk.object_offset
                    break
            if payload_offset is None:
                raise ValueError(
                    f"BytecodeArray {object_index} byte stream lacks payload provenance"
                )
            recovered.append(
                BytecodeArray(
                    object_index=object_index,
                    file_offset=parsed.header.header_size + payload_offset,
                    object_offset=parsed.header.header_size + obj.payload_offset,
                    bytecode_offset=start,
                    data=image[start : start + length],
                    instructions=instructions,
                    parameter_count=parameter_count,
                    register_count=register_count,
                    frame_size=frame_size,
                    constant_pool=constant_pool,
                    handler_table_size=len(handler_data),
                    handler_entries=_handler_entries(handler_data, parsed.profile),
                    source_position_table_size=len(source_position_data),
                )
            )
        recovered.sort(key=lambda array: array.object_index)
        parsed = ParsedDisassembly(
            header=parsed.header,
            profile=parsed.profile,
            tagged_size=parsed.tagged_size,
            objects=parsed.objects,
            arrays=tuple(recovered),
            functions=_function_infos(
                list(parsed.objects),
                recovered,
                parsed.profile,
                parsed.tagged_size,
                parsed.snapshot,
            ),
            runtime_variant=parsed.runtime_variant,
            snapshot=parsed.snapshot,
        )
        document = disassembly_to_dict(parsed)

    return load_structured_objects(document), missed_candidates


def select_functions(objects, patterns: list[str], *, exact: bool = False):
    from decompiler.context import DecompilerContext
    from decompiler.objects import V8BytecodeArray

    context = DecompilerContext(objects)
    lowered = [pattern.casefold() for pattern in patterns]
    selected = []
    for obj in objects:
        if not isinstance(obj, V8BytecodeArray):
            continue
        function = context.get_function_for_bytecode(obj)
        name = (
            context.get_function_name(function)
            if function is not None
            else f"anonymous_0x{obj.address:x}"
        )
        folded_name = name.casefold()
        if not lowered or any(
            folded_name == pattern if exact else pattern in folded_name
            for pattern in lowered
        ):
            selected.append((name, obj))
    return context, selected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("module", nargs="?", help="runtime module path")
    parser.add_argument("patterns", nargs="*", help="function-name substrings")
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--exe", type=Path, default=DEFAULT_EXE)
    parser.add_argument("--v8asm", type=Path, default=DEFAULT_V8ASM)
    parser.add_argument("--list-modules", action="store_true")
    parser.add_argument(
        "--find-module-for",
        action="append",
        default=[],
        metavar="ASCII",
        help="list modules whose cached payload contains an ASCII string",
    )
    parser.add_argument("--list-functions", action="store_true")
    parser.add_argument("--list-sfi", action="store_true")
    parser.add_argument("--show-addresses", action="store_true")
    parser.add_argument("--exact", action="store_true")
    parser.add_argument(
        "--contains",
        action="append",
        default=[],
        metavar="TEXT",
        help="decompile functions individually and keep those containing text",
    )
    parser.add_argument(
        "--constant",
        action="append",
        default=[],
        metavar="TEXT",
        help="keep functions whose constant pool references a matching string",
    )
    parser.add_argument("--linear", action="store_true")
    parser.add_argument("--json-index", action="store_true")
    parser.add_argument("--diagnose-false-bytecode", action="store_true")
    args = parser.parse_args()

    archive = args.archive.read_bytes()
    entries = archive_entries(archive)
    if args.json_index:
        print(json.dumps([entry.__dict__ for entry in entries.values()], indent=2))
        return 0
    if args.list_modules:
        print("\n".join(sorted(entries)))
        return 0
    if args.find_module_for:
        needles = [value.encode("utf-8") for value in args.find_module_for]
        for entry in entries.values():
            payload = archive[
                entry.payload_offset : entry.payload_offset + entry.payload_size
            ]
            matched = [
                args.find_module_for[index]
                for index, needle in enumerate(needles)
                if needle in payload
            ]
            if matched:
                print(f"{entry.name}\t{','.join(matched)}")
        return 0
    if not args.module:
        parser.error("module is required unless --list-modules is used")
    if args.module not in entries:
        matches = [name for name in entries if args.module.casefold() in name.casefold()]
        raise SystemExit("module not found; matches:\n" + "\n".join(matches[:50]))

    entry = entries[args.module]
    module_bytes = archive[
        entry.payload_offset : entry.payload_offset + entry.payload_size
    ]
    exe = args.exe.read_bytes()
    snapshot = exe[SNAPSHOT_OFFSET : SNAPSHOT_OFFSET + SNAPSHOT_LENGTH]
    objects, false_candidates = load_objects(
        module_bytes,
        snapshot,
        args.v8asm,
        diagnose_false=args.diagnose_false_bytecode,
    )
    if args.diagnose_false_bytecode:
        print(json.dumps(false_candidates, indent=2, default=str))
        return 0
    if args.list_sfi:
        from decompiler.objects import V8SharedFunctionInfo

        lowered = [pattern.casefold() for pattern in args.patterns]
        for obj in objects:
            if not isinstance(obj, V8SharedFunctionInfo):
                continue
            name = obj.name_value or ""
            if lowered and not any(pattern in name.casefold() for pattern in lowered):
                continue
            target = getattr(obj.trusted_function_data, "address", None)
            print(
                f"0x{obj.address:x}\t{name or '<anonymous>'}\t"
                f"{f'0x{target:x}' if target is not None else '<none>'}"
            )
        return 0
    context, selected = select_functions(objects, args.patterns, exact=args.exact)
    if args.constant:
        from decompiler.objects import V8String

        needles = [value.casefold() for value in args.constant]
        string_addresses = {
            obj.address
            for obj in objects
            if isinstance(obj, V8String)
            and any(needle in obj.value.casefold() for needle in needles)
        }
        selected = [
            (name, bytecode)
            for name, bytecode in selected
            if any(
                any(needle in entry.display.casefold() for needle in needles)
                or getattr(entry.raw, "address", None) in string_addresses
                for entry in context.constant_pool_entries(bytecode)
            )
        ]
    if args.list_functions:
        print(
            "\n".join(
                f"0x{bytecode.address:x}\t{name}"
                if args.show_addresses
                else name
                for name, bytecode in selected
            )
        )
        return 0

    from decompiler.core import _decompile_function_tree, decompile_bytecode

    for name, bytecode in selected:
        if args.contains:
            rendered = decompile_bytecode(context, bytecode, linear=args.linear)
            if not any(value.casefold() in rendered.casefold() for value in args.contains):
                continue
        else:
            rendered = _decompile_function_tree(context, bytecode, args.linear)
        parent = context.function_parent.get(bytecode.address)
        parent_note = f" parent=0x{parent:x}" if parent is not None else ""
        print(f"// ===== {name} @ 0x{bytecode.address:x}{parent_note} =====")
        print(rendered)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
