# Hokusai-Fi

A print studio and lo-fi radio. Every station you tune to pulls a new woodblock print in the
manner of Hokusai's *Under the Wave off Kanagawa*, carved entirely by code (no photographs, no
tracing), while the radio plays a generative lo-fi soundtrack composed from the same seed. Tune
to **1831** and the print is Hokusai's own composition.

![The studio](docs/studio.png)

## The studio

The print lies on a sheet of washi on a lamp-lit bench, with the carver's *kentō* registration
marks in its margin and pencil notes under it: its edition number, and how many impressions it
took to pull. Beside it, a tray holds a dish of each ink the edition is printed in, recut for its
weather. An old radio is the control surface:

- the **dial** tunes the sea: every seed has its own frequency, and typing a new station name
  pulls a new print;
- the **play** knob turns the radio on; its display shows the key, the scale the koto plays in
  and the tempo, and a level glows behind the speaker cloth;
- the **tune** knob finds a new station at random;
- **Set sail** opens the print out into an endless sea, printed just ahead of you as you row.

![Sailing out of the print](docs/voyage.png)

## Every seed is a new painting

Edition 1831 is Hokusai's composition. Every other edition is a window onto the generated sea
(see *One sea* below) with a great wave forced into it: its size, place and the way it breaks,
sometimes a second one behind it, Fuji far off in its hollow, the swell and the smaller crests
around it, and the **weather** (a clear day, dawn, a red evening, a moonlit night, a squall or
snow), each recutting the colour blocks.

![Six editions](docs/editions.png)

The same seed always prints the same sea, so a shared link shows your friend exactly your print.

## Sailing

Set sail and you sail straight out of the print: its water carries on past the edges of the
sheet, under its sky fading into the sea's own. The sea runs on through regions borrowed from the rest of the *Thirty-six Views*: the Kanagawa sea of
great waves, open swells, a calm bay under a large Fuji, a coast of pine
headlands, and rocky islets with a shrine gate, each region with its own weather. All of it is one sea,
carved the same way as the print.

Turn on **life** and the print moves: spray leaps from the curling lips and falls back, skeins
of seabirds cross, snow drifts down, rain slants in, petals blow past at dawn, and the sun and
moon breathe.

## The Fi

The soundtrack is generated live with Web Audio, nothing sampled: a swung, dusty beat, warm
electric-piano seventh chords that duck under the kick, a round bass, a koto plucking a Japanese
pentatonic melody (with the occasional *oshide* bend), a breathy shakuhachi, a temple bell, the
sea rolling underneath and the crackle of an old record. The seed sets the key, the chord loop
and the drum pattern; the weather sets the scale and tempo (yo on a clear day, *in* by
moonlight, hirajoshi in the snow, iwato in a squall), so the music turns as you sail.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/index.html: one self-contained file (~180 KB)
```

The build is a single HTML file with everything inlined, so you can send it to someone and they
can just double-click it. No server needed.

### Publish on GitHub Pages

The repo includes `.github/workflows/deploy.yml`. Do this once: in the GitHub repo go to
**Settings → Pages → Source: GitHub Actions**. After that, every push to `main` publishes the site
to `https://evandongchen.github.io/Hokusai-Fi/`. Link previews use `public/og.jpg`.

| Input | Action |
| --- | --- |
| `M` | Play / stop the radio |
| `N` | Tune to a new sea |
| `W` / `G` | Set sail / back to the bench |
| `←` `→`, drag, scroll | Row along the sea |
| `Space` | Hold still or drift |
| `A` | Bring the print to life / still it |
| `C` | Copy a link to this station |
| `S` | Pull a postcard (`Shift+S`: plain PNG) |
| `F` | Fullscreen |
| `I` | About |

URL parameters: `?seed=salt-crane-7`, `&mode=voyage`, `&speed=0..160`, `&animate=0`, `&intro=0`.

## How it works

Vite with plain TypeScript and no runtime dependencies. Everything is canvas 2D, printed the way a
woodblock print is: flat areas of colour, each from its own block, held together by the key
block's Prussian-blue lines, on washi paper.

**A composition, then carving.** `src/world/kanagawa.ts` holds what is where: a handful of curves
per element (the back of the great wave, the edge where its blue meets its foam, the hollow under
the lip, the crown of foam, the swells and their stripes, the boats' keels, Fuji) and a few numbers
telling the carving procedures how to work along them. `src/paint/ink.ts` holds the procedures,
Hokusai's marks:

- a **lobed edge**: where blue water meets white foam, the blue rises in rounded fingers that lean
  forward with the wave;
- a **talon**: a finger of foam that curls over at its end, outlined underneath by a dark hook,
  with a pale-indigo shadow pooled inside its curl; big talons split into smaller ones;
- a **crown**: talons packed over a mass of foam on a breaking crest;
- **strands** and **slivers**: long tapering stripes of lighter or darker blue running with the
  water;
- **flecks** of spray scattered over the blue and the sky.

Every mark is placed by these procedures from the seed. Key lines are carved as the brush drew
them, swelling and tapering, and a crest's foam is one mass breaking into fingers that split
into claws, outlined as one silhouette. Within an element the blocks are laid
down as a printer lays them, lightest first: the paper of the water, pale indigo, blue, deep
blue, the white of the foam, and last the key block's lines and hooks.

**The press.** Nothing is painted straight onto the sheet. Each chunk is cut into a colour block
and a key block (a colour laid over a line carves it away), then pulled onto washi in one
impression: the ink's density is broken up by the plank's grain, the baren's uneven rubbing,
the paper's fibres and tooth, and pools a little at the edges of each block, and the key block
sits a fraction out of register. All of it is anchored to the world, so chunks meet seamlessly.

**How close is 1831?** The composition's curves were tuned by an optimiser that nudged each
control point and carving parameter and kept whatever made the print agree better with the
original, measured as which ink (sky, foam, blue or boat) covers each cell of the print seen at
thumbnail size. Edition 1831 agrees with Hokusai's print in about 89% of those cells. The
reference was only used for that measurement and is not part of the project; the print is made
by the procedures alone, which is also why it can make every other edition.

**One sea.** Beyond Hokusai's own print the waves are not drawn one by one: the sea is one body
of water, a stack of bands from the horizon to the foot of the sheet, each a continuous surface
(`src/world/field.ts`). A swell runs through each band as a sum of trochoidal waves; seeded
packets of energy lift crests with long backs and steep fronts, sheared forward with their
height; where a packet is steep enough it breaks, and its lip reaches forward and rolls over,
tighter toward the tip, leaving the hollow open. `src/paint/surf.ts` carves that surface in the
print's manner: white backs with the blue rising into them in clawed fingers, stripes along the
surface, a crown of foam on each lip, and one key line along it all. Every mark is seeded by
where it lies, so the sea is the same however it is cut into chunks.

**An infinite world in chunks.** The world is cut into 740px-wide chunks, each generating its
features from `hash(seed, chunk)`, and every shape is drawn in world coordinates with a global
sort key, so neighbouring chunks print shared shapes identically and no seam shows. The print
fills the first two chunks. Workers print chunks off the main thread in short slices, so you can
watch the print being pulled.

| Path | Role |
| --- | --- |
| `src/core/` | Seeded RNG and hashing, noise, colour helpers, splines and paths, print primitives |
| `src/world/kanagawa.ts` | Hokusai's composition (edition 1831) |
| `src/world/field.ts` | The sea as one surface: bands, swell, packets of energy, breaking lips |
| `src/paint/ink.ts` | The carving procedures: lobed edges, talons, crowns, slivers, flecks |
| `src/paint/kanagawa.ts` | Prints a composition: sky, Fuji, waves, boats and spray, block by block |
| `src/world/world.ts` | Regions and weather of the endless sea, the colour blocks for each weather, chunked generation |
| `src/paint/surf.ts` | The field's surface carved in the print's manner |
| `src/paint/sea.ts` | The sea's ground, the horizon and ripples |
| `src/paint/sky.ts` | Graded sky, cloud bands, sun and moon, stars, snow and rain |
| `src/paint/shore.ts` | Fuji, far hills, pine headlands, islets with a shrine gate, distant sails |
| `src/paint/cartouche.ts` | The title cartouche and the seed's seal (drawn on the page, for its fonts) |
| `src/paint/press.ts` | The press: colour and key blocks pulled onto washi as one impression |
| `src/paint/chunks.ts`, `worker.ts`, `pool.ts` | Planning and printing chunks; the worker pool |
| `src/anim/life.ts` | The animation layer: spray, seabirds, weather, breathing sun and moon |
| `src/audio/music.ts` | The generative lo-fi soundtrack |
| `src/main.ts`, `src/styles.css` | The studio, the radio, sailing, input, sharing, postcards |
