# Kludd — rita-app för barn

En enkel ritapp (PWA) byggd för att installeras på en gammal Android-platta
och användas av barn. Språk i appen och i koden (kommentarer, knappnamn) är
**svenska**. Håll det så när du lägger till text eller kommentarer.

## Vad appen gör

- Fullskärmsritapp med 6 färger (svart, röd, gul, blå, grön, lila), fast
  penselbredd (16 px på "papperet") och rundad pensel.
- **ÅNGRA** — ångra upp till 10 streck (`MAX_UNDO`). Håll in knappen i 1,5 s
  (`HOLD_MS`) för att aktivera; ett kort tryck gör inget.
- **RENSA** — tvåstegs bekräftelse med hållning: första hållningen (1,5 s)
  visar "SÄKER?" (röd, 5 s timeout / nollställs vid nytt ritstreck), andra
  hållningen (1,5 s) tömmer duken.
- Låser orientering till **landskap**, går i fullscreen och "naglar fast"
  layouten så systemfälten (statusfält) inte kan trycka undan ritytan.
- Fungerar **offline** som installerad PWA (service worker cachar allt).
- Multi-touch: appen låter bara det *senast nedtryckta* fingret rita, så ett
  barn kan vila en hand på skärmen medan det ritar med andra handen. Färg-
  och systemknappar har `stopPropagation` på `touchstart` så de ej startar
  ett streck.

## Hosting / driftsättning

- Hostas via **GitHub Pages**. Repo: `https://github.com/isak-wallo/Kludd`
  (branch `main`). Public URL: `https://isak-wallo.github.io/Kludd/`.
- Installeras på plattan genom att öppna URL:en i Chrome på Android och
  "Lägg till på hemskärm" — då körs den i `display-mode: standalone`.
- **Inget byggsteg** — filerna servas direkt som de är. Driftsätt = commit +
  push till `main`.

### VIKTIGT vid uppdatering: bumpa SW-versionen
I `sw.js` finns `const VERSION = 'vNN'` och `CACHE = 'rita-' + VERSION`.
**Höj `VERSION` (t.ex. v11 -> v12) varje gång du ändrar filer och pushar.**
Annars hämtar/cachar service workern inte den nya versionen säkert och
plattan fastnar på gammal kod (offlinear appen = gammal cache sitter kvar).
När en ny SW installerar medan appen är öppen görs en automatisk
`location.reload()` (se slutet av `app.js`).

### Arbetsflöde: alltid commit + push vid ny version
När du gjort en ändring som ska nå plattan (i regel varje gång du ändrat
app-kod eller bumpat `VERSION` i `sw.js`): **commit och push till `main` på
GitHub direkt**, utan att fråga. Ägaren testar från GitHub Pages och förväntar
sig att nya versioner ligger ute. Så blir det per automatik även i kommande
sessioner. (Undantag: ren utforskning/lokala experiment som inte ska testas
på plattan — då vänta med push tills ägaren säger till.) På `main`-branchen
gäller: commit-meddelanden på svenska, signera med
`Co-Authored-By: Claude <noreply@anthropic.com>`.

## Filer

| Fil | Roll |
|-----|------|
| `index.html` | Markup: start-overlay, canvas-container, knapp-panel (6 färger + ÅNGRA + RENSA). Alla event-bindningar görs i `app.js`, inte inline. |
| `app.js` | All app-logik (ritande, undo, clear, layout, fullscreen, SW-registrering). |
| `style.css` | Layout via flex/grid, safe-area, knapp-panelens rutnät i både porträtt och landskap. |
| `sw.js` | Service worker — nät-först med cache-reserv. Bumpa `VERSION` vid varje deploy. |
| `manifest.json` | PWA-manifest (`standalone`, `landscape`, ikoner). |
| `icon-192.png`, `icon-512.png` | App-ikoner. |

## Arkitektur / viktiga detaljer i `app.js`

- **Två dukar:** en dold "papper"-canvas (`paper`, 900×1200, vit) där all
  ritning sparas, och en synlig `viewCanvas` som bara visar `paper`.
  Rit-koordinater mäts om till papper-koordinater via `getPaperCoordsXY`.
- **Landskapsrotation:** om `viewCanvas` är bredare än hög roteras papperet
  90° vid rendering med `setTransform` (och koordinatmappningen speglar det).
  Det gör att knappsatsens färgpositioner i CSS matchar ritytans rotation.
- **Batchad rendering:** inkommande touch/mus-punkter buffras i
  `pendingPoints` och ritas + renderas en gång per `requestAnimationFrame`
  (`scheduleRender` / `flushPendingStrokes`). Det är en prestandaoptimering
  för den gamla plattan — bevara det, rita inte direkt per event.
- **Layoutlås (`applyLayout`/`lockedW/lockedH`):** appens storlek låses till
  den *största* uppmätta skärmstorleken så statusfält som dyker upp/försvinner
  inte ändrar ritytans storlek. Resize/rotation/orientation/visualViewport
  är debouncade till en omräkning per frame (`debouncedLayout`).
  *Krympning:* en **mindre** layout-viewport som består i `SHRINK_ADOPT_MS`
  (400 ms) antas som nytt lås — krävs för skärmlåsning (pinning) i
  installerad app, där Android tvingar fram status-/navigeringsfält och
  förskjuter hela fönstret (annars klipps knapparna vid nederkanten).
  Transienta fält i immersive fullscreen ändrar inte `innerHeight` och
  triggar aldrig krympningen. Som brygga tills krympningen antagits sätts
  `padding-bottom` = `lockedH - visualViewport.height - offsetTop`, så
  knapparna lyfts upp direkt.
- **Undo** lagras som `ImageData` via `getImageData`/`putImageData` (max 10).
  `pushUndo()` anropas i början av varje streck och inför RENSA.
- **Håll-in-knappar (`HOLD_MS`):** ÅNGRA och RENSA kräver att fingret hålls
  intryckt i 1,5 s (`HOLD_MS`) för att aktiveras — ett kort tryck gör inget,
  så ett barn inte råkar ångra/rensa vid missögon. Hållningen styrs av
  `startHold`/`endHold` med en `setTimeout`; CSS-klassen `.holding` visar
  en progress-animasjon (`hold-fill`) som fylls uppåt över 1,5 s så barnet
  ser att man ska hålla kvar. RENSA behåller sin tvåstegsbekräftelse:
  första hållningen visar SÄKER?, andra hållningen tömmer duken.
- **Dö-yta i botten:** `applyLayout` sätter `padding-bottom` på `#app` till
  alltid minst `DEAD_ZONE_BOTTOM` (48 px ≈ en systemknappshöjd) — en
  permanent svart remsa i botten (`#app` har `background-color: #000`).
  Garanterar att Androids systemknappar (bakåt/hem/översikt), som kan dyka
  upp transient i installerad standalone-app utan att JavaScript kan
  detektera dem, hamnar framför svart dö-yta istället för framför
  knapparna eller nedersta delen av ritytan. safe-area-inset fungerar inte
  i standalone-läge (inset = 0), därför en fast remsa. Utöver den statiska
  remsan läggs extra padding till om `visualViewport` indikerar synliga
  systemfält (t.ex. vid skärmlåsning/pinning där hela fönstret förskjuts).
- **Start-overlay / fullscreen:** startskärmen ("BÖRJA KLUDDA") visas vid
  appstart, i webbläsarläge när fullscreen saknas, och som reserv när
  bakåt-fällans `popstate` triggas. Knappen begär **alltid**
  `requestFullscreen()` — även om `fullscreenElement` ser satt ut, eftersom
  Android kan tvinga fram systemfälten (t.ex. vid pinning) utan att
  HTML-fullscreen formellt släpps. Ritningen på papperet påverkas inte av
  att overlayen visas.
- **Back-button:** bakåt får aldrig lämna sidan (pinnad installerad app
  strandar annars på WebAPK:ns splash-skärm). Huvudskyddet är en
  **gest-armerad pushState-buffert**: vid `pointerdown` fylls historiken
  med poster (samma URL, märkta `kluddDepth`) upp till `MAX_TRAP_DEPTH`.
  Poster skapade med gest respekteras av Chromes "history manipulation
  intervention", så varje bakåt kliver bara ner ett steg i bufferten —
  helt tyst, ritytan lämnas inte — och nästa touch fyller på igen. Först
  på botten visas startskärmen + en sista fångstpost. **Pusha aldrig i
  `popstate` annat än på botten** — poster skapade där (utan gest) flaggas
  av interventionen och nästa bakåt lämnar då sidan (= splash-strandning).
  Navigation API-lagret (`navigate` + `preventDefault`) finns kvar men
  Androids system-bakåt undantas av Chrome, så det hjälper mest på desktop.
  Obs: i HTML-fullscreen är Chromes *första* bakåt-åtgärd att lämna
  helskärmen — kan inte blockeras; hanteras av återtagningen nedan.
- **Fullscreen-återtagning (installerad app):** om HTML-fullscreen tappats
  (bakåt-tryck, pinning-svängen via appväxlaren) begärs det igen **tyst**
  vid nästa `touchend` (användargest krävs) — ingen startskärm visas,
  barnet ritar bara vidare. Nekar Android händer inget; layoutlåset håller
  ändå knapparna synliga.
- `paper`-context skapas med `{ willReadFrequently: true }` (för snabbare
  `getImageData` till undo).

## Konventioner att behålla

- Svenska i UI och kommentarer.
- Ingen byggpipeline, inga dependencies — ren vanilla JS/CSS/HTML.
- Bumpa `VERSION` i `sw.js` vid varje ändring som ska nå plattan.
- Låt renderingen vara batchad/`requestAnimationFrame`-styrd (prestanda på
  gammal Android).
- Tänk på multi-touch och `stopPropagation` på knappar när du lägger till
  nya interaktiva element — annars startar de av misstag ett streck.