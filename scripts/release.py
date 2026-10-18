#!/usr/bin/env python3
"""Build public source/install ZIPs using an explicit allowlist. No network access."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = [
    'README.md', 'LICENSE', 'NOTICE.md', 'PRIVACY.md', 'CHANGELOG.md',
    'CONTRIBUTING.md', 'SECURITY.md', '.gitignore', '.gitattributes',
]
ASSET_NOTICES = [
    'extension/assets/README.md',
    'extension/assets/pet-with-you/LICENSE',
    'extension/assets/pet-with-you/LICENSE.upstream',
    'extension/assets/pet-with-you/ATTRIBUTION.md',
    'extension/assets/pet-with-you/sources.json',
]


def required(relative):
    path = ROOT / relative
    if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
        raise ValueError('Missing or unsafe public file: ' + str(relative))
    return path


def check_files(files):
    """Catch personal paths and common credential formats without printing matches."""
    patterns = [
        re.compile(r'[A-Za-z]:[\\/]Users[\\/]', re.I),
        re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        re.compile(r'\bsk-[A-Za-z0-9_-]{24,}\b'),
        re.compile(r'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b'),
    ]
    for relative in files:
        path = required(relative)
        if path.suffix.lower() in {'.webm', '.png'}:
            continue
        text = path.read_text(encoding='utf-8')
        if any(pattern.search(text) for pattern in patterns):
            raise ValueError('Review possible private data in: ' + relative)
        if path.suffix.lower() != '.md':
            continue
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
            if target.startswith(('https://', 'http://', 'mailto:', '#')):
                continue
            target = target.split('#', 1)[0]
            if not (path.parent / target).is_file():
                raise ValueError('Broken document link: ' + relative + ' -> ' + target)


def write_zip(path, prefix, files):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for relative in sorted(files):
            archive.write(required(relative), prefix + '/' + relative)
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError('Corrupt ZIP member: ' + bad)


def main():
    manifest = json.loads(required('extension/manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){0,3}', version):
        raise ValueError('Invalid extension version')
    runtime = {'extension/manifest.json', 'extension/' + manifest['background']['service_worker']}
    for entry in manifest['content_scripts']:
        runtime.update('extension/' + name for name in entry['js'])
    for entry in manifest.get('web_accessible_resources', []):
        for resource in entry['resources']:
            matches = sorted((ROOT / 'extension').glob(resource))
            if not matches:
                raise ValueError('No files match resource: ' + resource)
            runtime.update(p.relative_to(ROOT).as_posix() for p in matches)
    catalog_text = required('extension/pet-catalog.js').read_text(encoding='utf-8')
    catalog = json.loads(catalog_text.split('=', 1)[1].strip().removesuffix(';'))
    actions = [action for group in catalog['groups'] for action in group['actions']]
    if len(actions) != 100 or len({a['id'] for a in actions}) != 100:
        raise ValueError('Expected 100 uniquely identified animations')
    expected_videos = {'extension/' + action['file'] for action in actions}
    actual_videos = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'extension/assets/pet-with-you').glob('*.webm')}
    if expected_videos != actual_videos:
        raise ValueError('Animation directory differs from the current catalog')
    sources = json.loads(required('extension/assets/pet-with-you/sources.json').read_text(encoding='utf-8'))
    if len(sources['files']) != len(actions) or {a['id']: a['file'] for a in sources['files']} != {a['id']: a['file'] for a in actions}:
        raise ValueError('Animation source records differ from the current catalog')
    for action in actions:
        name = 'extension/' + action['file']
        if name not in runtime or required(name).read_bytes()[:4] != bytes.fromhex('1a45dfa3'):
            raise ValueError('Missing or invalid WebM: ' + name)
    runtime.update(ASSET_NOTICES)
    docs = {p.relative_to(ROOT).as_posix() for p in (ROOT / 'docs').glob('*.md')}
    if not docs:
        raise ValueError('Missing user documentation')
    install_images = {'操作步骤图/' + str(i) + '.png' for i in range(1, 7)}
    install = runtime | docs | set(ROOT_FILES) | install_images
    source = install | {'scripts/release.py'}
    for directory, pattern in [('tests', '*.test.cjs'), ('preview', '*'), ('.github/ISSUE_TEMPLATE', '*.md')]:
        source.update(p.relative_to(ROOT).as_posix() for p in (ROOT / directory).glob(pattern) if p.is_file())
    if not any(name.startswith('tests/') for name in source):
        raise ValueError('Missing source tests')
    check_files(source)
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    packages = [
        (output / ('deepseek-quotalk-' + version + '.zip'), 'deepseek-quotalk-' + version, install),
        (output / ('deepseek-quotalk-source-' + version + '.zip'), 'deepseek-quotalk-source-' + version, source),
    ]
    checksums = []
    for path, prefix, files in packages:
        write_zip(path, prefix, files)
        checksums.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name)
        print(path.name + ': ' + str(len(files)) + ' files, ' + str(round(path.stat().st_size / 1048576, 1)) + ' MiB')
    (output / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n', encoding='utf-8')
    (output / 'PUBLIC_FILES.txt').write_text('\n'.join(sorted(source)) + '\n', encoding='utf-8')
    print('Public file checks and ZIP integrity checks passed.')


if __name__ == '__main__':
    main()
