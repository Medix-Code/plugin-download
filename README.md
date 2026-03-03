# Descarregador d'Imatges

Extensio de Chrome per revisar les imatges visibles de la pestanya actual, descarregar nomes les que seleccionis i capturar vista, blocs o pagina sencera com PNG.

## Fitxers

- `manifest.json`: configuracio de l'extensio.
- `background/index.js`: entrada principal del service worker (MV3 module).
- `background/router.js`: dispatch i validacio dels missatges runtime.
- `background/downloads/*`: gestio de descarregues i ZIP.
- `background/capture/index.js`: captura vista/bloc/pagina i stitching.
- `background/offscreen.js`: gestio de l'offscreen document per object URLs.
- `background/windows/index.js`: obertura de la finestra ampliada.
- `shared/*`: constants, missatges, logger i tipus JSDoc compartits.
- `popup.html`: finestra de seleccio.
- `popup.css`: estils de la finestra.
- `popup.js`: bootstrap del popup (mode modul).
- `popup/*`: estat, accions, render, settings, logs i events runtime.
- `icons/`: icones PNG i SVG de l'extensio.
- `docs/refactor-checklist.md`: checklist manual de validacio del refactor.

## Installacio

1. Obre `chrome://extensions/`.
2. Activa `Developer mode`.
3. Fes clic a `Load unpacked`.
4. Selecciona aquesta carpeta: `/home/aksss/Code/plugin-download`.
5. Obre qualsevol web i fes clic a la icona de l'extensio.
6. El popup llistara les imatges detectades amb checkbox.
7. Selecciona les que vulguis i fes clic a `Descarregar`.
8. Si hi ha mes d'una imatge seleccionada, l'extensio crea un `ZIP` unic.
9. La llista usa paginacio de `20` imatges per pagina amb controls `Anterior/Seguent`.
10. Les descarregues i captures es guarden a `Downloads/Image Picker/`.
11. L'extensio te acces de lectura als fitxers `http/https` per poder crear el `ZIP` sense demanar permisos extra a cada descarrega.
12. `Captura bloc` et deixa clicar un element concret de la pagina i el retalla com PNG.
13. `Analitza bloc` et deixa clicar un element i obtenir JSON amb estils, tipografia, colors, text i assets detectats.

## Notes

- Descarrega `jpg`, `jpeg`, `png`, `webp`, `gif`, `svg` i `avif`.
- Ignora URLs sense extensio valida.
- Quan hi ha diverses imatges seleccionades, crea un `ZIP` unic. Si no el pot crear, mostra error en lloc de baixar-les una per una.
- Totes les descarregues i captures van a `Downloads/Image Picker/`.
- Les analisis de bloc es poden copiar al porta-retalls o guardar com JSON a `Downloads/Image Picker/`.
- Quan analitzes un bloc, el filtre `Bloc analitzat` deixa veure nomes les imatges detectades dins aquell bloc.
- Si la pestanya es `chrome://` o una pagina protegida del navegador, Chrome no deixara escanejar-la.
- `Captura bloc` retalla nomes l'element que cliquis a la pagina, util per previews amb gradient i composicio final.
