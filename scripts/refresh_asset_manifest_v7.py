#!/usr/bin/env python3
"""Include the rebuilt track-dependent context in the v7 asset manifest."""
import gzip
import hashlib
import json
from pathlib import Path

root=Path(__file__).resolve().parents[1]/'assets'
target=root/'atlas-build-manifest.json'
manifest=json.loads(target.read_text())
assert manifest['schema']=='western-disturbances-atlas-assets-v7'
jet=json.loads((root/'wd-atlas-jet-v7.json').read_text())
names=['wd-atlas-routes-v7.json.gz','wd-atlas-climate-v7.json.gz','wd-atlas-jet-v7.json','wd-reanalysis-matches-v7.json.gz']
names += [Path(d['file']).name for d in jet['diagnostics']]
for name in names:
    data=(root/name).read_bytes()
    manifest['assets']['context:'+name]={'file':name,'bytes':len(data),'uncompressed_bytes':len(gzip.decompress(data)) if name.endswith('.gz') else len(data),'sha256':hashlib.sha256(data).hexdigest()}
target.write_text(json.dumps(manifest,indent=2)+'\n')
print(f"{len(manifest['assets'])} checksummed assets")
