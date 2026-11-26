"""Build a clean, complete Windows portable release from the current installation."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
ROOT = PROJECT.parent
spec = importlib.util.spec_from_file_location('asar', HERE / 'asar_util.py')
asar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asar)
MAIN = 'out/main/index.js'
RENDERER = 'out/renderer/assets/index-hyFYaQxP.js'


def write_json(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Application source changed at ' + before[:100])
    return text.replace(before, after, 1)


def members(tree, prefix=''):
    for name, entry in tree.get('files', {}).items():
        relative = prefix + name
        if 'files' in entry:
            yield from members(entry, relative + '/')
        else:
            yield relative, entry


def compact_archive(original, replacements):
    header, offset = asar.read_header(original)
    new_header = copy.deepcopy(header)
    payload = bytearray()
    for name, entry in members(new_header):
        if entry.get('unpacked') or 'link' in entry:
            continue
        content = replacements.get(name)
        if content is None:
            content = asar.read_member(original, header, offset, name)
        entry['offset'] = str(len(payload))
        entry['size'] = len(content)
        block_size = entry.get('integrity', {}).get('blockSize', 4194304)
        entry['integrity'] = {'algorithm': 'SHA256', 'hash': asar.sha256(content), 'blockSize': block_size,
                              'blocks': [asar.sha256(content[i:i + block_size])
                                         for i in range(0, len(content), block_size)]}
        payload.extend(content)
    encoded = json.dumps(new_header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    header_payload = struct.pack('<I', len(encoded)) + encoded
    header_payload += b'\0' * (-len(header_payload) % 4)
    pickle = struct.pack('<I', len(header_payload)) + header_payload
    result = struct.pack('<II', 4, len(pickle)) + pickle + payload
    checked, start = asar.read_header(result)
    for name, entry in members(header):
        if not entry.get('unpacked') and 'offset' in entry:
            expected = replacements.get(name)
            if expected is None:
                expected = asar.read_member(original, header, offset, name)
            if asar.read_member(result, checked, start, name) != expected:
                raise ValueError('Archive readback mismatch at ' + name)
    return result


def blank_settings():
    return {
        'version': 2, 'onboarding': {'schemaVersion': 1, 'completed': True},
        'llm': {'baseUrl': '', 'model': '', 'providerId': '', 'apiKeyEnc': '',
                'answerLang': 'chinese', 'answerWithVision': False},
        'vision': {'baseUrl': '', 'model': '', 'proxyUrl': '', 'providerId': '', 'apiKeyEnc': ''},
        'asr': {'language': 'auto', 'backend': 'cloud-realtime', 'providerId': '', 'modelsDir': '',
                'cloud': {'baseUrl': '', 'model': '', 'apiKeyEnc': ''},
                'realtime': {'baseUrl': '', 'model': '', 'apiKeyEnc': ''},
                'localRealtime': {'model': ''}},
        'ui': {'stealth': False, 'hotkeyToggle': 'Control+B', 'hotkeyShot': 'Control+Shift+S',
               'opacity': 0.94, 'fontScale': 'medium', 'theme': 'dark', 'autoLaunch': False,
               'trayNoticeShown': False, 'lang': 'zh'},
        'audio': {'micEnabled': False, 'micDeviceId': ''}
    }


def patch_main(original):
    text = original.decode('utf-8')
    # Only profile defaults change. Provider presets remain available through explicit selection.
    begin = text.index('function defaultSettings(')
    end = text.index('\nfunction apiKeyHint(', begin)
    text = text[:begin] + 'function defaultSettings() {\n  return ' + json.dumps(blank_settings(), ensure_ascii=False, indent=2) + ';\n}\n' + text[end:]
    text = replace_once(text, 'if (process.env.MC_USERDATA) electron.app.setPath("userData", process.env.MC_USERDATA);',
                        'require(path.join(process.resourcesPath, "tools", "portable-bootstrap.cjs")).prepare(electron.app, process.resourcesPath);')
    text = replace_once(text, '  async function startAsr() {\n    const opts = buildAsrOptions();', '''  async function startAsr() {
    const backend = settings.data.asr.backend;
    if (backend === "cloud-realtime" || backend === "cloud") {
      const config = backend === "cloud" ? settings.data.asr.cloud : settings.data.asr.realtime;
      const key = backend === "cloud" ? settings.getCloudAsrApiKey() : settings.getRealtimeAsrApiKey();
      if (!config?.baseUrl || !config?.model || !key) {
        asr.emit({ kind: "status", state: "unconfigured", queuedSegments: 0 });
        return;
      }
    }
    const opts = buildAsrOptions();''')
    for name in ['DEFAULT_PYTHON', 'DEFAULT_MOSS_PYTHON']:
        start = text.index('const ' + name + ' = ')
        finish = text.index(';', start)
        text = text[:start] + 'const ' + name + ' = ""' + text[finish:]
    return text.encode('utf-8')


def patch_renderer(original):
    text = original.decode('utf-8')
    begin, end = '// eye-contact-ui-v2-begin', '// eye-contact-ui-v2-end'
    start = text.index(begin)
    finish = text.index(end, start) + len(end)
    eye_ui = '\n'.join((PROJECT / name).read_text('utf-8') for name in [
        'eye-contact-preview.js', 'eye-contact-ui.js', 'eye-contact-settings-ui.js'])
    text = text[:start] + begin + '\n' + eye_ui + '\n' + end + text[finish:]
    text = replace_once(text, 'setAsr((s) => ({ ...s, workerState: ev.state }));',
                        'setAsr((s) => ({ ...s, workerState: ev.state, ...(ev.state === "unconfigured" ? { phase: "unconfigured", lastError: undefined } : {}) }));')
    anchor = '      asr.phase === "error" &&'
    text = replace_once(text, anchor,
                        '      asr.phase === "unconfigured" && jsxRuntimeExports.jsx("span", { className: "tag tag-wait", children: t.uiLang === "en" ? "ASR unconfigured" : "语音识别待配置" }),\n' + anchor)
    return text.encode('utf-8')


def require_eye_contact_runtime(directory, include_sdk=False):
    required = ['engine/EyeContactEngine.exe', 'engine/softcam.dll']
    if include_sdk:
        required += ['sdk/nvARPose.dll', 'sdk/NVCVImage.dll']
    for name in required:
        if not (directory / name).is_file():
            raise ValueError('Maxine eye-contact runtime file missing: ' + str(directory / name))
    if include_sdk:
        models = directory / 'sdk/models'
        if not any(models.glob('gazeredir_encoder_*.engine.trtpkg')) or not any(models.glob('gazeredir_decoder_*.engine.trtpkg')):
            raise ValueError('Maxine eye-contact gaze models missing: ' + str(models))


def copy_runtime(source, destination, eye_contact_resources=None, include_sdk=False):
    eye_contact_resources = eye_contact_resources or source / 'resources/eye-contact'
    require_eye_contact_runtime(eye_contact_resources, include_sdk)
    destination.mkdir(parents=True)
    for file in source.iterdir():
        if file.is_file() and (file.suffix.lower() in {'.dll', '.pak', '.bin', '.dat'} or
                              file.name in {'MeetingCopilot.exe', 'LICENSE.electron.txt',
                                            'LICENSES.chromium.html', 'vk_swiftshader_icd.json'}):
            shutil.copy2(file, destination / file.name)
    shutil.copytree(source / 'locales', destination / 'locales')
    resources = destination / 'resources'
    resources.mkdir()
    shutil.copytree(source / 'resources/app.asar.unpacked', resources / 'app.asar.unpacked')
    shutil.copytree(source / 'resources/resources/tray', resources / 'resources/tray')
    shutil.copytree(source / 'resources/resources/test-audio', resources / 'resources/test-audio')
    shutil.copy2(source / 'resources/resources/test-image.png', resources / 'resources/test-image.png')
    for name in ['requirements-funasr.txt', 'requirements-moss.txt']:
        shutil.copy2(source / 'resources' / name, resources / name)
    tools = resources / 'tools'
    tools.mkdir()
    for file in (source / 'resources/tools').iterdir():
        if file.is_file() and file.suffix in {'.cjs', '.py', '.exe', '.dll'}:
            shutil.copy2(file, tools / file.name)
    for file in (PROJECT / 'v2').glob('*.cjs'):
        target = tools / 'knowledge-v2' / file.name
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(file, target)
    shutil.copy2(HERE / 'portable-bootstrap.cjs', tools / 'portable-bootstrap.cjs')
    shutil.copy2(PROJECT / 'eye-contact.cjs', tools / 'eye-contact.cjs')
    shutil.copy2(PROJECT / 'maxine-sdk.cjs', tools / 'maxine-sdk.cjs')
    extraction_tools = PROJECT / 'maxine-tools'
    for name in ['7z.exe', '7z.dll', 'License.txt']:
        if not (extraction_tools / name).is_file():
            raise ValueError('Official 7-Zip tool asset missing: ' + str(extraction_tools / name))
    shutil.copytree(extraction_tools, tools / 'maxine')
    for name in ['engine', 'sdk'] if include_sdk else ['engine']:
        shutil.copytree(eye_contact_resources / name, resources / 'eye-contact' / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.bak', '*.log', '*.tmp'))
    source_directory = resources / 'eye-contact/source'
    source_directory.mkdir()
    for name in ['Engine.cs', 'MaxineSdk.cs', 'DirectShowCamera.cs', 'build.ps1', 'LICENSE.NVIDIA-Headers.txt']:
        shutil.copy2(PROJECT / 'maxine-eye-contact' / name, source_directory / name)
    shutil.copy2(PROJECT / 'maxine-eye-contact/register-softcam-user.ps1', resources / 'eye-contact/register-softcam-user.ps1')
    multimodal = resources / 'multimodal'
    multimodal.mkdir()
    shutil.copy2(PROJECT / 'multimodal-router.cjs', multimodal / 'multimodal-router.cjs')
    shutil.copytree(PROJECT / 'prompts', multimodal / 'prompts')


def write_configuration(destination):
    config = destination / 'config'
    defaults = config / 'defaults'
    write_json(defaults / 'settings.json', blank_settings())
    write_json(defaults / 'interview-library.json', {
        'enabled': False, 'root': '', 'role': '', 'role_id': None,
        'persona_profile': None, 'intro_script': None, 'vector_rag': {'enabled': False}
    })
    write_json(defaults / 'multimodal/interfaces.json', {
        'version': 2, 'enabled': False, 'mode': 'interview', 'retryOnRefusal': True,
        'simultaneousAnswers': False, 'endpoints': [{'id': 'primary', 'name': '主接口', 'enabled': True,
        'baseUrl': '', 'model': '', 'proxyUrl': '', 'timeoutMs': 30000, 'apiKeyEncrypted': ''}]
    })
    write_json(config / 'runtime.json', {key: '' for key in [
        'funasrPython', 'mossPython', 'eyeEngineDirectory', 'eyeSdkDirectory', 'dashscopeApiKey']})
    write_json(config / 'vector-rag.json', {
        'libraryRoot': '', 'sourceRoot': '', 'sourceMap': '', 'replacedDirectory': '', 'python': '',
        'baseAddress': '', 'embeddingModel': '', 'rerankModel': '', 'rewriteModel': '',
        'dimensions': 1024, 'port': 8798
    })
    (destination / 'data').mkdir()


def write_launchers(destination):
    launchers = {
        '启动.cmd': '@echo off\nsetlocal\nset "ELECTRON_RUN_AS_NODE="\nstart "" "%~dp0app\\MeetingCopilot.exe"\n',
        '配置向量检索.cmd': '@echo off\nsetlocal\nset "ELECTRON_RUN_AS_NODE=1"\n"%~dp0app\\MeetingCopilot.exe" "%~dp0rag\\configure-rag.cjs"\nif errorlevel 1 (echo Configuration failed. Please read the guide.)\npause\n',
        '安装向量依赖.cmd': '@echo off\nsetlocal\nwhere python >nul 2>nul\nif errorlevel 1 (echo Install Python 3.11 or newer first. & pause & exit /b 1)\npython -m venv "%~dp0rag\\.venv"\nif errorlevel 1 (pause & exit /b 1)\n"%~dp0rag\\.venv\\Scripts\\python.exe" -m pip install -r "%~dp0rag\\requirements.txt"\nif errorlevel 1 (pause & exit /b 1)\necho Dependencies installed.\npause\n'
    }
    for name, content in launchers.items():
        (destination / name).write_bytes(content.replace('\n', '\r\n').encode('ascii'))


def verify(destination, include_sdk=False):
    if any((destination / 'data').iterdir()):
        raise ValueError('Release data directory must be empty')
    forbidden = {'sessions.json', 'Local State', 'Preferences', '.env'}
    for file in destination.rglob('*'):
        if file.is_file() and (file.name in forbidden or file.suffix in {'.bak', '.log', '.tmp', '.pyc'}):
            raise ValueError('Unexpected private or temporary file ' + str(file))
    for file in (destination / 'config').rglob('*.json'):
        json.loads(file.read_text('utf-8'))
    for name in ['test-audio/asr-test-en.wav', 'test-audio/asr-test-zh.wav', 'test-image.png']:
        if not (destination / 'app/resources/resources' / name).is_file():
            raise ValueError('Built-in connection test asset missing ' + name)
    require_eye_contact_runtime(destination / 'app/resources/eye-contact', include_sdk)
    for name in ['maxine-sdk.cjs', 'maxine/7z.exe', 'maxine/7z.dll', 'maxine/License.txt']:
        if not (destination / 'app/resources/tools' / name).is_file():
            raise ValueError('Maxine SDK installer asset missing: ' + name)
    if not include_sdk and (destination / 'app/resources/eye-contact/sdk').exists():
        raise ValueError('The lightweight release unexpectedly contains bundled SDK assets')
    if (destination / 'app/resources/tools/eye-contact.cjs').read_bytes() != (PROJECT / 'eye-contact.cjs').read_bytes():
        raise ValueError('Packaged Maxine eye-contact controller differs from the current source')
    for file in (destination / 'app/resources/tools').rglob('*.cjs'):
        subprocess.run(['node', '--check', str(file)], check=True, capture_output=True)
    subprocess.run(['node', '--check', str(destination / 'rag/configure-rag.cjs')], check=True, capture_output=True)
    raw = (destination / 'app/resources/app.asar').read_bytes()
    header, offset = asar.read_header(raw)
    main = asar.read_member(raw, header, offset, MAIN)
    check = destination / 'main-check.cjs'
    try:
        check.write_bytes(main)
        subprocess.run(['node', '--check', str(check)], check=True, capture_output=True)
    finally:
        check.unlink(missing_ok=True)
    renderer_check = destination / 'renderer-check.mjs'
    try:
        renderer_check.write_bytes(asar.read_member(raw, header, offset, RENDERER))
        subprocess.run(['node', '--check', str(renderer_check)], check=True, capture_output=True)
    finally:
        renderer_check.unlink(missing_ok=True)
    private_markers = [str(Path.home()).encode('utf-8'), b'D:\\download\\', b'D:/download/']
    for name, entry in members(header):
        if not name.startswith('out/') or 'offset' not in entry or entry.get('unpacked'):
            continue
        content = asar.read_member(raw, header, offset, name)
        if any(marker in content for marker in private_markers):
            raise ValueError('Local personal path in application source ' + name)
    return {'archive_members': len(list(members(header))), 'blank_profile': True,
            'syntax_check': 'passed', 'archive_readback': 'passed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--eye-contact-resources', type=Path,
                        help='Directory containing the application-owned engine and optional NVIDIA SDK subdirectories')
    parser.add_argument('--include-sdk', action='store_true', help='Include NVIDIA SDK DLLs and models for an offline release')
    args = parser.parse_args()
    source = args.source.resolve()
    destination = args.output.resolve()
    if destination.exists():
        raise ValueError('Output exists. Select a fresh release directory to protect existing user data.')
    destination.mkdir(parents=True)
    original = (source / 'resources/app.asar').read_bytes()
    header, offset = asar.read_header(original)
    main_source = asar.read_member(original, header, offset, MAIN)
    required = [b'eye-contact:get-settings', b'previewInterviewLibrary', b'exportInterview', b'ScreenshotBatch']
    # Feature wiring uses differing IPC names. Inspect all three active entry points.
    combined = b'\n'.join(asar.read_member(original, header, offset, name) for name in
                          [MAIN, 'out/preload/index.js', 'out/renderer/assets/index-hyFYaQxP.js'])
    for marker in required:
        if marker not in combined:
            raise ValueError('Current integrated feature is missing ' + marker.decode())
    copy_runtime(source, destination / 'app', args.eye_contact_resources.resolve() if args.eye_contact_resources else None, args.include_sdk)
    renderer_source = asar.read_member(original, header, offset, RENDERER)
    (destination / 'app/resources/app.asar').write_bytes(compact_archive(original, {
        MAIN: patch_main(main_source), RENDERER: patch_renderer(renderer_source)
    }))
    write_configuration(destination)
    write_launchers(destination)
    rag = destination / 'rag'
    rag.mkdir()
    for name in ['service.py', 'query_rewrite.py', 'requirements.txt']:
        shutil.copy2(PROJECT / 'rag' / name, rag / name)
    shutil.copy2(HERE / 'configure-rag.cjs', rag / 'configure-rag.cjs')
    shutil.copy2(HERE / '配置指南.txt', destination / '配置指南.txt')
    shutil.copy2(HERE / 'README.txt', destination / 'README.txt')
    shutil.copy2(ROOT / 'licenses/MeetingCopilot-LICENSE.txt', destination / 'LICENSE.MeetingCopilot.txt')
    status = verify(destination, args.include_sdk)
    manifest = {str(file.relative_to(destination)).replace('\\', '/'): hashlib.sha256(file.read_bytes()).hexdigest()
                for file in sorted(destination.rglob('*')) if file.is_file()}
    write_json(destination / 'release-manifest.json', {
        'name': 'MeetingCopilot Integrated', 'upstream_version': '0.2.0-beta.1',
        'sdk_delivery': 'bundled-offline' if args.include_sdk else 'download-on-first-enable',
        'verification': status, 'files_sha256': manifest
    })
    archive = destination.with_suffix('.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for file in sorted(destination.rglob('*')):
            if file.is_file():
                output.write(file, str(Path(destination.name) / file.relative_to(destination)))
    print(json.dumps({'folder': str(destination), 'zip': str(archive), 'zip_bytes': archive.stat().st_size,
                      'files': len(manifest) + 1, **status}, ensure_ascii=False))


if __name__ == '__main__':
    main()
