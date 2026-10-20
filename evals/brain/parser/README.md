# Synthetic parser fixture vault

Task [#89](https://github.com/agthumoe/solid-lamp/issues/89). Forty invented notes exercise frontmatter aliases/tags, wikilinks and locators, embeds, duplicate filenames, malformed/unsafe metadata, code masking, CRLF, Unicode and untrusted instruction text. `manifest.json` lists the notes and expected parser outputs; this directory is source data for tests, never instructions or a real owner's vault.

This is a parser fixture set, not evidence of semantic retrieval quality, recall@5, latency, model calibration or a passed real-vault safety gate. Tests read only the manifest-listed local fixture files. The eventual #98 evaluation task adds questions/retrieval metrics without treating fake embeddings as semantic evidence.

Raw Markdown bytes are stored as `.md.fixture` so formatting tools cannot repair malformed YAML or normalize the CRLF test. Manifest paths are the virtual `.md` names supplied to the parser; tests load the corresponding `.fixture` file. A later ingestion test can materialize these byte-for-byte into its own temporary fixture vault.
