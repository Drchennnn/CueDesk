import importlib.util
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('eye_installer', ROOT / 'meeting-copilot/install_eye_contact.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class EyeContactPackageChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        archive = Path(os.environ['LOCALAPPDATA']) / 'Programs/meeting-copilot/resources/app.asar'
        cls.original = archive.read_bytes()
        header, offset = installer.asar.read_header(cls.original)
        cls.sources = [installer.asar.read_member(cls.original, header, offset, name).decode('utf-8')
                       for name in [installer.MAIN, installer.PRELOAD, installer.RENDERER]]

    def test_upgrade_is_repeatable_and_wires_the_camera_tab(self):
        result = installer.upgrade_sources(*self.sources)
        repeated = installer.upgrade_sources(*(result[name].decode('utf-8') for name in result))
        self.assertEqual(result, repeated)
        renderer = result[installer.RENDERER].decode('utf-8')
        self.assertEqual(renderer.count('function EyeContactSettings('), 1)
        self.assertEqual(renderer.count('function createEyeContactPreview('), 1)
        self.assertIn("h(EyeContactSettings,{active:active==='camera'})", renderer)
        self.assertIn('settingsFile: path.join', result[installer.MAIN].decode('utf-8'))
        self.assertIn('getEyeContactDiagnostics:', result[installer.PRELOAD].decode('utf-8'))

    def test_foreign_sources_fail_closed(self):
        with self.assertRaises((ValueError, IndexError)):
            installer.upgrade_sources('unknown main', 'unknown preload', 'unknown renderer')


if __name__ == '__main__':
    unittest.main()
