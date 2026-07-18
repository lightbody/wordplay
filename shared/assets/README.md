# Word list

`nwl2023.txt` is the NASPA Word List 2023 Edition (NWL2023), © 2024
[NASPA](https://scrabbleplayers.org/) — the official lexicon for club and
tournament play in the US and Canada (196,601 words, 2–15 letters,
effective February 29, 2024). NASPA permits free community software to
include the list with appropriate credit and links; commercial use
requires a license from NASPA (see <https://scrabbleplayers.org/w/NWL2023>).

The file is one lowercase word per line, produced from the
`words/North-American/NWL2023.txt` file in
<https://github.com/scrabblewords/scrabblewords> by stripping definitions,
lowercasing, and sorting:

```bash
awk '{print tolower($1)}' NWL2023.txt | tr -d '\r' | sort -u > nwl2023.txt
```

It replaced the public-domain ENABLE list (172,823 words, ~2000), which
predated the 2006 lexicon additions — notably two-letter staples like ZA
and QI — and still contained slurs that NWL2020+ removed.
