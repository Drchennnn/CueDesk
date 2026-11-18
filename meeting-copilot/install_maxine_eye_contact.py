"""Install the source-built Maxine engine into an already-integrated MeetingCopilot."""
import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('asar', HERE / 'install.py')
asar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asar)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True,
                        help='Directory containing engine/ and sdk/')
    parser.add_argument('--app', type=Path,
                        default=Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot')
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    app = args.app.resolve()
    for name in ['engine/EyeContactEngine.exe', 'engine/softcam.dll',
                 'sdk/nvARPose.dll', 'sdk/NVCVImage.dll', 'sdk/models']:
        if not (runtime / name).exists():
            raise ValueError('Runtime resource missing ' + name)
    archive = (app / 'resources/app.asar').read_bytes()
    header, offset = asar.read_header(archive)
    main_source = asar.read_member(archive, header, offset, 'out/main/index.js')
    for marker in [b'eye-contact:set-enabled', b'eye-contact:get-settings', b'eye-contact.cjs']:
        if marker not in main_source:
            raise ValueError('Install the MeetingCopilot camera UI integration first')
    asar.require_closed(app)
    subprocess.run(['node', '--check', str(HERE / 'eye-contact.cjs')], check=True)
    resources = app / 'resources'
    controller = resources / 'tools/eye-contact.cjs'
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = resources / ('maxine-eye-contact-backup-' + stamp)
    stage = resources / ('eye-contact-stage-' + stamp)
    target = resources / 'eye-contact'
    backup.mkdir()
    if controller.is_file():
        shutil.copy2(controller, backup / 'eye-contact.cjs')
    # Staging preserves the current controller and runtime through copy failures.
    shutil.copytree(runtime, stage)
    companions = {'register-softcam-user.ps1': 'register-softcam-user.ps1'}
    companions.update({'source/' + name: name for name in [
        'Engine.cs', 'MaxineSdk.cs', 'DirectShowCamera.cs', 'build.ps1', 'LICENSE.NVIDIA-Headers.txt']})
    for relative, name in companions.items():
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / 'maxine-eye-contact' / name, destination)
    files = {}
    for source in sorted(runtime.rglob('*')):
        if source.is_file():
            relative = source.relative_to(runtime)
            value = digest(source)
            if value != digest(stage / relative):
                raise RuntimeError('Runtime readback mismatch ' + str(relative))
            files[str(relative).replace('\\', '/')] = value
    for relative, name in companions.items():
        value = digest(HERE / 'maxine-eye-contact' / name)
        if value != digest(stage / relative):
            raise RuntimeError('Source readback mismatch ' + relative)
        files[relative] = value
    previous_runtime = backup / 'eye-contact'
    replacement = controller.with_suffix('.cjs.maxine-stage')
    try:
        shutil.copy2(HERE / 'eye-contact.cjs', replacement)
        if target.exists():
            target.rename(previous_runtime)
        stage.rename(target)
        os.replace(replacement, controller)
    except Exception:
        if target.exists() and not stage.exists():
            target.rename(stage)
        if previous_runtime.exists():
            previous_runtime.rename(target)
        if (backup / 'eye-contact.cjs').is_file():
            shutil.copy2(backup / 'eye-contact.cjs', controller)
        raise
    receipt = {'implementation': 'meetingcopilot-maxine-direct',
               'runtime': str(target), 'backup': str(backup),
               'controllerSha256': digest(controller), 'runtimeSha256': files}
    (backup / 'installation.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'installed': str(target), 'backup': str(backup),
                      'files': len(files)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
