# Combines every validation file into one: validation-final.json. Run: python3 bench/build-final.py
import json, glob, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
order = ['dev', 'sealed', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'h1', 'h2', 'h3', 'casual', 'real']
seen, out, counts = set(), [], {}
def add(row, name):
    key = (row['text'], bool(row.get('addr')))
    if key in seen: return
    seen.add(key)
    r = dict(row); r['set'] = name
    out.append(r); counts[name] = counts.get(name, 0) + 1
for name in order:
    for row in json.load(open(f'validation-{name}.json')): add(row, name)
for name, f in [('old-dataset', 'dataset.json'), ('old-holdout', 'holdout.json')]:
    for row in json.load(open(f)): add({'text': row['text'], 'label': row['label'], 'tag': 'legacy'}, name)
json.dump(out, open('validation-final.json', 'w'), indent=1, ensure_ascii=False)
bad = sum(r['label'] for r in out)
print(f'validation-final.json: {len(out)} messages ({bad} should be removed, {len(out)-bad} should be left alone)')
for k, v in counts.items(): print(f'  {k:12} {v}')
