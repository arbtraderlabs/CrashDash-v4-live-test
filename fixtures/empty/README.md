# fixtures/empty

MODE 1 — EMPTY. No `data/` directory at all: simulates a site where no
product data has ever been published (or the initial deploy has not run
yet). The build/candidate for this mode contains only the static shell
(`index.html`, `*.js`) and no `data/` directory whatsoever.

Expected frontend behaviour: page shell renders, navigation renders, no
uncaught JS exceptions, and a controlled `productDataStatus = "EMPTY"`
banner ("No product data has been published yet.").
