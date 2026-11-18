"""Extract and verify the existing eye-contact feature as a reusable module ZIP."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
ROOT = SOURCE.parent


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Controller source changed at ' + before[:90])
    return text.replace(before, after, 1)


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def controller_source():
    text = (SOURCE / 'eye-contact.cjs').read_text('utf-8')
    text = replace_once(text,
        'function createWindowsPlatform({ userProfile, appData, log = () => {} }) {',
        'function createWindowsPlatform({ userProfile, appData, engineDirectory = process.env.MC_EYE_ENGINE_DIR,\n'
        '  sdkDirectory = process.env.MC_EYE_SDK_DIR, log = () => {} }) {')
    text = replace_once(text,
        "const helperDir = path.join(userProfile, 'Tinks', 'resources', 'eye-contact');",
        "const helperDir = engineDirectory || path.join(userProfile, 'Tinks', 'resources', 'eye-contact');")
    text = replace_once(text,
        '    const candidates = fs.existsSync(cache) ?',
        "    if (sdkDirectory && (!fs.existsSync(path.join(sdkDirectory, 'nvARPose.dll')) ||\n"
        "        !fs.existsSync(path.join(sdkDirectory, 'models')) || !fs.statSync(path.join(sdkDirectory, 'models')).isDirectory())) {\n"
        "      throw new Error('指定 SDK 目录缺少 nvARPose.dll 或 models 文件夹。');\n"
        "    }\n"
        '    const candidates = sdkDirectory ? [sdkDirectory] : fs.existsSync(cache) ?')
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination.exists():
        raise ValueError('Select a fresh output directory to preserve any configured copy.')
    destination.mkdir(parents=True)
    for name in ['eye-contact-ui.js', 'eye-contact-settings-ui.js', 'eye-contact-preview.js',
                 'eye-contact.test.cjs', 'eye-contact-preview.test.cjs', 'eye-contact-settings-ui.test.cjs']:
        shutil.copy2(SOURCE / name, destination / name)
    (destination / 'eye-contact.cjs').write_text(controller_source(), encoding='utf-8')
    for name in ['electron-main.cjs', 'preload.cjs', 'integration.test.cjs', 'README.txt',
                 '安装与接入Prompt.txt', 'styles.css']:
        shutil.copy2(HERE / name, destination / name)
    shutil.copy2(ROOT / 'licenses/MeetingCopilot-LICENSE.txt', destination / 'LICENSE.txt')
    renderer = "import * as reactExports from 'react';\nimport * as jsxRuntimeExports from 'react/jsx-runtime';\n\n"
    renderer += '\n\n'.join((SOURCE / name).read_text('utf-8') for name in
                            ['eye-contact-preview.js', 'eye-contact-ui.js', 'eye-contact-settings-ui.js'])
    renderer += '\n\nexport {createEyeContactPreview, eyeContactStatus, EyeContactToggle, EyeContactSettings};\n'
    (destination / 'renderer.mjs').write_text(renderer, encoding='utf-8')
    write_json(destination / 'package.json', {
        'name': 'meetingcopilot-eye-contact', 'version': '0.1.0', 'private': True,
        'description': 'Extracted Windows eye-contact controller and Electron/React integration',
        'license': 'Apache-2.0', 'main': './eye-contact.cjs',
        'exports': {'.': './eye-contact.cjs', './electron-main': './electron-main.cjs',
                    './preload': './preload.cjs', './renderer': './renderer.mjs', './styles.css': './styles.css'},
        'scripts': {'test': 'node --test *.test.cjs'}, 'engines': {'node': '>=18'},
        'peerDependencies': {'react': '>=18'},
        'peerDependenciesMeta': {'react': {'optional': True}}
    })
    write_json(destination / 'config/runtime.json', {'eyeEngineDirectory': '', 'eyeSdkDirectory': ''})
    output = subprocess.run(['node', '-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).DEFAULT_SETTINGS))',
                             str(destination / 'eye-contact.cjs')], check=True, capture_output=True, text=True)
    settings = json.loads(output.stdout)
    assert settings['sourceDeviceId'] == settings['sourceDeviceName'] == ''
    write_json(destination / 'config/settings.example.json', settings)
    for file in destination.iterdir():
        if file.suffix in {'.cjs', '.mjs', '.js'}:
            subprocess.run(['node', '--check', str(file)], check=True, capture_output=True)
    tests = sorted(str(file) for file in destination.glob('*.test.cjs'))
    result = subprocess.run(['node', '--test', '--test-reporter=tap', *tests], capture_output=True, text=True,
                            encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    summary = {key: int(re.search(r'^# ' + key + r' (\d+)$', result.stdout, re.MULTILINE)[1])
               for key in ['tests', 'pass', 'fail', 'skipped']}
    assert summary['fail'] == summary['skipped'] == 0
    write_json(destination / '验证结果.json', {
        'date': '2026-11-17', 'syntax': 'passed', 'automated_tests': summary,
        'coverage': ['engine lifecycle and settings', 'idle release and bounded recovery',
                     'preview first frame, cancellation and track cleanup', 'settings UI',
                     'IPC sender checks, subscription cleanup and registration rollback'],
        'real_camera_test': '待目标电脑安装引擎与 SDK 后执行',
        'bundle_type': 'Windows Electron/React 模块源码包',
        'external_resources': ['suisi-eye-contact.exe and its dependencies', 'softcam.dll',
                               'GPU-compatible NVIDIA AR SDK and models']
    })
    for file in destination.rglob('*'):
        if file.is_file() and any(marker in file.read_bytes() for marker in [b'17128', b'D:\\download\\', b'D:/download/']):
            raise ValueError('Personal path in ' + str(file.relative_to(destination)))
    hashes = {file.relative_to(destination).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest()
              for file in sorted(destination.rglob('*')) if file.is_file()}
    write_json(destination / 'manifest.json', {'files_sha256': hashes})
    archive = destination.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for file in sorted(destination.rglob('*')):
            if file.is_file():
                zipped.write(file, str(Path(destination.name) / file.relative_to(destination)))
    with zipfile.ZipFile(archive) as zipped:
        assert zipped.testzip() is None
        for name, digest in hashes.items():
            assert hashlib.sha256(zipped.read(destination.name + '/' + name)).hexdigest() == digest
    print(json.dumps({'zip': str(archive), 'bytes': archive.stat().st_size,
                      'files': len(hashes) + 1, 'verification': summary}, ensure_ascii=True))


if __name__ == '__main__':
    main()
