# Assets

## The icon

`icon-16.png`, `icon-32.png`, `icon-48.png` and `icon-128.png` are generated, not drawn by hand:

```bash
npm run icons      # node scripts/make-icons.mjs
```

The generator rasterises signed-distance shapes with 6× supersampling and encodes the PNGs directly
with `node:zlib` — no canvas, no image library, no dependency. It is deterministic, so the committed
PNGs can be reproduced byte for byte, and an icon change is a pull request against arithmetic rather
than a binary blob someone has to trust.

The mark is an hourglass (time passing while the AI works) on a rounded tile, with a green dot for
"an answer has landed". It is a generic hourglass, drawn from coordinates.

## No third-party logos

You will notice this extension ships **no ChatGPT, Claude, Gemini, Perplexity or DeepSeek logos**.
That is deliberate, not an oversight. Each of those marks is a trademark of its owner, and this
project is not affiliated with, endorsed by, or licensed by any of them. Reproducing their logos in a
product that drives their sites — particularly in store art — invites a complaint that is entirely
avoidable.

Instead, each site gets a `monogram` (a letter or mark) and a brand-adjacent `color`, both defined in
`src/lib/sites.js`. The UI draws a small coloured chip with that monogram. It is unmistakable at a
glance, it costs nothing, and it keeps the project's legal footing clean.

If you fork this and add real logos, that is your call and your risk — but note that the store
artwork rules of both Chrome and Firefox treat this as a trademark issue for the rights holder to
raise, and it is a bad way to lose a listing.
