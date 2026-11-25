import importlib.util
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('portable_build', ROOT / 'meeting-copilot/release/build_portable.py')
portable_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portable_build)
spec = importlib.util.spec_from_file_location('module_build', ROOT / 'meeting-copilot/maxine-eye-contact/build_package.py')
module_build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module_build)


class LightweightReleaseChecks(unittest.TestCase):
    def fixture(self, root):
        project = root / 'project'
        source = root / 'installed'
        resources = source / 'resources'
        release = project / 'release'
        files = {
            source / 'MeetingCopilot.exe': 'synthetic application',
            source / 'locales/en-US.pak': 'synthetic locale',
            resources / 'resources/tray/tray.png': 'synthetic tray',
            resources / 'resources/test-audio/asr-test-en.wav': 'synthetic audio',
            resources / 'resources/test-image.png': 'synthetic image',
            resources / 'requirements-funasr.txt': '',
            resources / 'requirements-moss.txt': '',
            resources / 'tools/QuietCapture.exe': 'synthetic capture',
            resources / 'tools/eye-contact.cjs': 'old controller',
            resources / 'tools/maxine-sdk.cjs': 'old installer',
            resources / 'eye-contact/engine/EyeContactEngine.exe': 'synthetic native engine',
            resources / 'eye-contact/engine/softcam.dll': 'synthetic camera',
            resources / 'eye-contact/sdk/nvARPose.dll': 'synthetic SDK',
            resources / 'eye-contact/sdk/NVCVImage.dll': 'synthetic SDK image',
            resources / 'eye-contact/sdk/models/gazeredir_encoder_fp16_86.engine.trtpkg': 'synthetic encoder',
            resources / 'eye-contact/sdk/models/gazeredir_decoder_fp16_86.engine.trtpkg': 'synthetic decoder',
            project / 'eye-contact.cjs': 'current controller',
            project / 'maxine-sdk.cjs': 'current installer with inline manifest',
            project / 'maxine-tools/7z.exe': 'official tool fixture',
            project / 'maxine-tools/7z.dll': 'official library fixture',
            project / 'maxine-tools/License.txt': 'official license fixture',
            project / 'v2/library.cjs': 'synthetic knowledge library',
            project / 'multimodal-router.cjs': 'synthetic multimodal router',
            project / 'prompts/written.md': 'synthetic prompt',
            release / 'portable-bootstrap.cjs': 'synthetic bootstrap',
        }
        for name in ['Engine.cs', 'MaxineSdk.cs', 'DirectShowCamera.cs', 'build.ps1',
                     'LICENSE.NVIDIA-Headers.txt', 'LICENSE.softcam.txt', 'register-softcam-user.ps1',
                     'README.txt', '安装与接入Prompt.txt', '验收结果.txt', 'launch.ps1', 'bin/EyeContactEngine.exe']:
            files[project / 'maxine-eye-contact' / name] = 'synthetic source or license'
        files[project / 'maxine-eye-contact/config.example.json'] = '{"sdkDirectory":"","deviceName":""}'
        for file, text in files.items():
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(text, encoding='utf-8')
        (resources / 'app.asar.unpacked').mkdir()
        return project, source, release

    def test_lightweight_runtime_contains_engine_installer_and_official_unpacker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, source, release = self.fixture(root)
            destination = root / 'lightweight/app'
            with patch.object(portable_build, 'PROJECT', project), patch.object(portable_build, 'HERE', release):
                portable_build.copy_runtime(source, destination)
            resources = destination / 'resources'
            self.assertTrue((resources / 'eye-contact/engine/EyeContactEngine.exe').is_file())
            self.assertFalse((resources / 'eye-contact/sdk').exists())
            self.assertEqual((resources / 'tools/maxine-sdk.cjs').read_text(), 'current installer with inline manifest')
            self.assertEqual((resources / 'tools/eye-contact.cjs').read_text(), 'current controller')
            self.assertEqual((resources / 'tools/maxine/7z.exe').read_text(), 'official tool fixture')
            self.assertTrue((resources / 'tools/maxine/7z.dll').is_file())
            self.assertTrue((resources / 'tools/maxine/License.txt').is_file())

    def test_explicit_offline_runtime_contains_sdk_and_gaze_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, source, release = self.fixture(root)
            destination = root / 'offline/app'
            with patch.object(portable_build, 'PROJECT', project), patch.object(portable_build, 'HERE', release):
                portable_build.copy_runtime(source, destination, include_sdk=True)
            sdk = destination / 'resources/eye-contact/sdk'
            self.assertTrue((sdk / 'nvARPose.dll').is_file())
            self.assertTrue((sdk / 'models/gazeredir_encoder_fp16_86.engine.trtpkg').is_file())

    def test_lightweight_runtime_requires_only_the_engine_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = root / 'engine'
            engine.mkdir()
            for name in ['EyeContactEngine.exe', 'softcam.dll']:
                (engine / name).write_bytes(b'synthetic')
            portable_build.require_eye_contact_runtime(root)
            with self.assertRaises(ValueError):
                portable_build.require_eye_contact_runtime(root, include_sdk=True)

    def test_independent_module_defaults_to_downloadable_sdk_and_blank_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, source, release = self.fixture(root)
            output = root / 'module'
            arguments = ['build_package.py', '--softcam', str(source / 'resources/eye-contact/engine/softcam.dll'),
                         '--output', str(output)]
            with patch.object(module_build, 'HERE', project / 'maxine-eye-contact'), \
                 patch.object(module_build, 'PROJECT', project), \
                 patch.object(module_build.subprocess, 'run') as compile_core, \
                 patch.object(sys, 'argv', arguments), redirect_stdout(io.StringIO()):
                module_build.main()
            compile_core.assert_called_once()
            self.assertFalse((output / 'runtime/sdk').exists())
            self.assertTrue((output / 'runtime/tools/maxine/7z.exe').is_file())
            self.assertTrue((output / 'runtime/tools/maxine-sdk.cjs').is_file())
            self.assertEqual(json.loads((output / 'config.json').read_text(encoding='utf-8'))['sdkDirectory'], '')
            self.assertEqual(json.loads((output / 'manifest.json').read_text(encoding='utf-8'))['sdk_delivery'], 'download-on-first-start')
            with zipfile.ZipFile(output.with_suffix('.zip')) as archive:
                self.assertIsNone(archive.testzip())
                self.assertFalse(any('/runtime/sdk/' in name for name in archive.namelist()))

    def test_independent_module_offline_flag_copies_the_explicit_sdk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, source, release = self.fixture(root)
            output = root / 'offline-module'
            arguments = ['build_package.py', '--softcam', str(source / 'resources/eye-contact/engine/softcam.dll'),
                         '--sdk-dir', str(source / 'resources/eye-contact/sdk'), '--include-sdk', '--output', str(output)]
            with patch.object(module_build, 'HERE', project / 'maxine-eye-contact'), \
                 patch.object(module_build, 'PROJECT', project), \
                 patch.object(module_build.subprocess, 'run'), \
                 patch.object(sys, 'argv', arguments), redirect_stdout(io.StringIO()):
                module_build.main()
            self.assertTrue((output / 'runtime/sdk/nvARPose.dll').is_file())
            self.assertEqual(json.loads((output / 'manifest.json').read_text(encoding='utf-8'))['sdk_delivery'], 'bundled-offline')


if __name__ == '__main__':
    unittest.main(verbosity=2)
