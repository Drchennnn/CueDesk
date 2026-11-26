"""Build a lightweight source-backed Maxine module with an optional offline SDK."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-dir', type=Path)
    parser.add_argument('--include-sdk', action='store_true', help='Bundle the supplied SDK for offline use')
    parser.add_argument('--softcam', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sdk = args.sdk_dir.resolve() if args.sdk_dir else None
    softcam = args.softcam.resolve()
    output = args.output.resolve()
    if args.include_sdk:
        if sdk is None:
            raise ValueError('--include-sdk requires --sdk-dir')
        for name in ['nvARPose.dll', 'NVCVImage.dll', 'models']:
            if not (sdk / name).exists():
                raise ValueError('SDK asset missing ' + name)
    extraction_tools = PROJECT / 'maxine-tools'
    for name in ['7z.exe', '7z.dll', 'License.txt']:
        if not (extraction_tools / name).is_file():
            raise ValueError('Official 7-Zip tool asset missing: ' + str(extraction_tools / name))
    if not (PROJECT / 'maxine-sdk.cjs').is_file():
        raise ValueError('Maxine SDK manager source is missing')
    if not softcam.is_file():
        raise ValueError('Softcam DLL missing')
    if output.exists():
        raise ValueError('Select a fresh output directory')
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
                    '-File', str(HERE / 'build.ps1')], check=True)
    engine = output / 'runtime/engine'
    engine.mkdir(parents=True)
    shutil.copy2(HERE / 'bin/EyeContactEngine.exe', engine / 'EyeContactEngine.exe')
    shutil.copy2(softcam, engine / 'softcam.dll')
    shutil.copy2(HERE / 'LICENSE.softcam.txt', engine / 'LICENSE.softcam.txt')
    if args.include_sdk:
        shutil.copytree(sdk, output / 'runtime/sdk')
    tools = output / 'runtime/tools'
    tools.mkdir()
    shutil.copy2(PROJECT / 'maxine-sdk.cjs', tools / 'maxine-sdk.cjs')
    shutil.copytree(extraction_tools, tools / 'maxine')
    source = output / 'source'
    source.mkdir()
    for file in HERE.glob('*.cs'):
        shutil.copy2(file, source / file.name)
    shutil.copy2(HERE / 'build.ps1', source / 'build.ps1')
    shutil.copy2(HERE / 'LICENSE.NVIDIA-Headers.txt', source / 'LICENSE.NVIDIA-Headers.txt')
    shutil.copy2(HERE.parent / 'eye-contact.cjs', source / 'eye-contact.cjs')
    for name in ['README.txt', 'launch.ps1', 'config.example.json', 'register-softcam-user.ps1']:
        shutil.copy2(HERE / name, output / name)
    shutil.copy2(HERE / 'config.example.json', output / 'config.json')
    (output / '启动.cmd').write_bytes(
        b'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"\r\n')
    files = {str(file.relative_to(output)).replace('\\', '/'):
             hashlib.sha256(file.read_bytes()).hexdigest()
             for file in sorted(output.rglob('*')) if file.is_file()}
    manifest = {'implementation': 'meetingcopilot-maxine-direct',
                'configuration': 'blank personal paths and devices',
                'sdk_delivery': 'bundled-offline' if args.include_sdk else 'download-on-first-start',
                'lightweight_runtime_requirement': 'Node.js 22 or newer for SDK acquisition',
                'files_sha256': files}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    archive = output.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for file in sorted(output.rglob('*')):
            if file.is_file():
                target.write(file, str(Path(output.name) / file.relative_to(output)))
    print(json.dumps({'folder': str(output), 'zip': str(archive),
                      'bytes': archive.stat().st_size, 'files': len(files) + 1}, ensure_ascii=False))


if __name__ == '__main__':
    main()
