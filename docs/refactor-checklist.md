# Refactor Checklist (MV3)

## Definition of Done per fase

- La checklist manual de la fase queda en verd.
- No canvien els `action` de `chrome.runtime.sendMessage`.
- No canvien les claus de `chrome.storage.local` (`pluginLogs`, `hideFixedSticky`, `upscaleEnabled`, `upscaleFactor`, `askWhereToSave`).
- El comportament visible de la UI es manté.

## Contractes de missatgeria

### Popup -> Background

- `downloadImages`
- `captureVisibleTab`
- `captureFullPage`
- `startElementCaptureFlow`
- `openExpandedPopup`

### Contingut (overlay) -> Background

- `elementSelectedForCapture`

### Background -> Popup

- `pluginLogEntry`
- `fullPageCaptureProgress`
- `elementCaptureStatus`

## Casos manuals

1. Escaneig d'imatges en web normal i error esperat en `chrome://`.
2. Filtres de tipus i mida amb comptador visible/total correcte.
3. Seleccionar tot, deseleccionar visibles, modal de preview.
4. Descarrega d'una imatge amb i sense `saveAs`.
5. Descarrega multi-imatge amb ZIP.
6. Fallback quan falla ZIP.
7. Upscale 2x/4x en formats suportats.
8. Formats no suportats amb resultat original.
9. Captura vista normal i amb upscale.
10. Captura bloc amb selecció i cancel·lació (`Esc`).
11. Captura pàgina amb progrés, reintents i finalització.
12. Opció d'amagar `fixed/sticky` activa i desactivada.
13. Obertura en finestra gran preservant `tabId/windowId`.
14. Persistència de settings i logs entre sessions.
15. Neteja de logs i missatges d'error visibles.
