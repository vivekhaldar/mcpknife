# Dictionary API Demos

Five progressive demos using the [Free Dictionary API](https://dictionaryapi.dev/) to showcase mcpknife's pipeline capabilities.

**API:** `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`
**Returns:** definitions, phonetics (with audio URLs), synonyms, antonyms, parts of speech, examples, etymology.

---

## Demo 1: Hello World — Basic Pipeline

**Exercises:** `boot` + `mod` (rename) + `ui`

The simplest possible end-to-end pipeline. One command, three stages, working tool.

```bash
mcpknife boot --prompt "Free Dictionary API — look up English word definitions \
    https://dictionaryapi.dev/" \
  | mcpknife mod --prompt "Rename the lookup tool to 'define'" \
  | mcpknife ui
```

mcpknife reads the API docs, generates an MCP server with a word lookup tool, renames it to something clean, and adds a UI. Zero-to-working-tool in one pipe.

---

## Demo 2: Thesaurus Mode — Tool Filtering + Synthetic Tools

**Exercises:** `boot` + `mod` (filter fields, create synthetic tools) + `ui`

Shows how `mod` can reshape a general-purpose API into a focused tool.

```bash
mcpknife boot --prompt "Free Dictionary API https://dictionaryapi.dev/" \
  | mcpknife mod --prompt "Create two focused tools: 'synonyms' returns only \
      synonyms grouped by part of speech, 'antonyms' returns only antonyms. \
      Hide the raw lookup tool." \
  | mcpknife ui
```

`mod` doesn't just rename — it carves out focused tools from a broad API, hiding the raw endpoint and exposing purpose-built alternatives. The UI gives you a clean thesaurus interface.

---

## Demo 3: Pronunciation Trainer — Multi-Mod Pipeline

**Exercises:** `boot` + `mod` (extract/reshape) + `mod` (second stage, add synthetic tool) + `ui`

Chains multiple `mod` stages. Each stage progressively refines.

```bash
mcpknife boot --prompt "Free Dictionary API https://dictionaryapi.dev/" \
  | mcpknife mod --prompt "Reshape the tool to return only phonetic transcription \
      (IPA text) and audio URL for pronunciation. Call it 'pronounce'." \
  | mcpknife mod --prompt "Add a second tool 'similar_sounds' that takes a word, \
      gets its phonetic transcription, and suggests words that rhyme or sound similar." \
  | mcpknife ui
```

Two `mod` stages in one pipe — first reshapes the data, second adds a derived synthetic tool on top. Demonstrates that the pipe protocol works for arbitrary chain lengths.

---

## Demo 4: Vocabulary Flashcards — Synthetic Aggregation Tool

**Exercises:** `boot` + `mod` (combine fields into structured output) + `ui` (custom-tailored)

Shows `mod` creating a completely new tool shape optimized for a specific use case.

```bash
mcpknife boot --prompt "Free Dictionary API https://dictionaryapi.dev/" \
  | mcpknife mod --prompt "Create a 'flashcard' tool that takes a word and returns \
      a structured flashcard with: the word, one-line definition, example sentence, \
      3 synonyms, part of speech, and pronunciation. Keep it concise — this is for \
      studying, not reference." \
  | mcpknife ui
```

`mod` synthesizes a completely new tool shape from an existing API — not just filtering fields but restructuring for a use case. The UI becomes a flashcard study interface.

---

## Demo 5: Word Explorer — The Grand Finale

**Exercises:** `boot` + `mod` (rich structured output + multiple tools) + `ui` (compelling interactive UI)

The showcase demo. Everything mcpknife can do, producing a polished result.

```bash
mcpknife boot --prompt "Free Dictionary API — comprehensive English word lookup \
    with definitions, pronunciation audio, synonyms, antonyms, and etymology \
    https://dictionaryapi.dev/" \
  | mcpknife mod --prompt "Create three tools: \
      (1) 'explore' — takes a word, returns a rich structured result with: \
          all definitions grouped by part of speech, pronunciation with audio URL, \
          synonyms and antonyms as arrays, and any example sentences. \
      (2) 'compare' — takes two words, returns their definitions side by side \
          with shared synonyms highlighted. \
      (3) 'word_of_the_day' — takes no arguments, picks a random interesting \
          English word and returns its full exploration." \
  | mcpknife ui
```

The full power — boot generates the base, mod creates three specialized tools from one API (single-word explore, comparison, and a zero-arg discovery tool), and ui produces a rich interactive experience with audio links, grouped definitions, and side-by-side comparison.

---

## Feature Coverage

| Demo | boot | mod (rename) | mod (filter) | mod (synthetic) | multi-mod | ui | Pipe |
|------|------|-------------|-------------|----------------|-----------|-----|------|
| 1. Hello World | ✓ | ✓ | | | | ✓ | ✓ |
| 2. Thesaurus | ✓ | | ✓ | ✓ | | ✓ | ✓ |
| 3. Pronunciation | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ |
| 4. Flashcards | ✓ | | | ✓ | | ✓ | ✓ |
| 5. Word Explorer | ✓ | | | ✓ (×3 tools) | | ✓ | ✓ |

Progression: simple → focused → chained → restructured → showcase.
