# Brain scoring fixtures and private-question template

Task [#98](https://github.com/agthumoe/solid-lamp/issues/98). `known-run.json` is an invented fake-result run with hand-calculated expected scores. It verifies scoring only; it is not a semantic model evaluation or evidence that the vault is ready.

After explicit real-vault approval and the complete recovery/path gate, copy `private-questions.template.json` to **`backups/brain-evals/questions.json`**, which the existing repository ignore rules cover, and restrict directory/file permissions to the owner. Replace the placeholders locally and have the owner review expected note/heading answers. Never commit private questions, expected paths or raw search observations to this directory, CI artifacts or issue comments. Only approved aggregate evidence may be published.

Freeze the calibration/held-out split and profile/chunker/threshold identities before an actual run. The future search runner supplies observations and independently verifies citations. The template contains questions only; it is not an executable run and cannot satisfy the strict scorer without observations. The scorer omits raw queries/citations from aggregate output. A reported provenance label is an input assertion; the actual runner must establish it, and a fake run cannot certify semantic recall. No score alone establishes the Phase 2 safety gate.
