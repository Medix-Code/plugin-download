# Compatibilitat de fonts mockup (bloc analitzat)

Aquest resum documenta quins tipus d'assets pot trobar el plugin en webs de mockups i com els processa sense canviar el flux UX actual.

## Fonts suportades al ZIP de bloc

- `http://` i `https://`
- `blob:`
- `data:image/*`
- `filesystem:`

## On es detecten

- `layer.imageUrl`
- `layer.sources[]`
- `layer.backgroundImageUrls[]`
- URLs dins `layer.backgroundImage` (qualsevol `url(...)`)
- URLs dins `layer.maskImage` (qualsevol `url(...)`)
- `layer.maskSource`

## Enduriments aplicats

- Si un asset ve com `blob:`/`filesystem:`, la lectura via pestanya es fa al `MAIN world` per millorar compatibilitat.
- Si el nom resultant acaba en `.bin`, s'intenta inferir extensio real des del `mimeType` (`jpg/png/webp/gif/svg/avif`).
- El llistat d'imatges del popup pot incloure assets `blob:` i `data:image/*` (com extensio `bin` quan no es pot inferir millor).

## Limitacions reals (esperades)

- `blob:` caducats/revocats per la web no es poden recuperar.
- Alguns recursos protegits pel site poden fallar si la sessio/token ha expirat.
- Si la web renderitza via `canvas` sense URL de font exposada, no existeix asset individual descarregable (cal captura raster).
