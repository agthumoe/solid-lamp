# Routing golden design cases

Task: [#21](https://github.com/agthumoe/solid-lamp/issues/21). [42 cases](cases.json) for the future domain-routing policy, with [interpretation and coverage](../../docs/workstreams/codex/evaluation-design.md). Each case recursively patches a fresh defaults object; arrays/null replace. Synthetic passed evidence is hypothetical. Do not import these states into active configuration.

No runtime test harness is added here. Existing CI checks repository quality/formatting; it does not execute these decision oracles. The following dependency-free command verifies basic dataset syntax/count/identity invariants from the worktree root:

```sh
python3 - <<'PYCODE'
import json
from pathlib import Path
suite = json.loads(Path('evals/routing/cases.json').read_text())
cases = suite['cases']
assert suite['schemaVersion'] == suite['boundaryVersion'] == 1
assert len(cases) == 42
assert len({case['id'] for case in cases}) == len(cases)
for case in cases:
    assert case['description'] and case['coverage']
    expected = case['expected']
    assert expected['kind'] in {'route', 'fallback', 'clarify', 'reject', 'partial-failure'}
    assert expected['reason'] and expected['attemptLimit'] == 2
    assert expected['writeAllowed'] is False
print('42 unique design cases parsed; no policy or model executed')
PYCODE
```

For implementation, map these independent expected decisions into a parameterized policy-port test; add metamorphic properties and fake-clock scheduler tests separately. See the scheduling contract for its acceptance matrix. No GPU/download/private-data work is authorized by these fixture files.
