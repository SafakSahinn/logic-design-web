# Board files

The FPGA board definitions in this folder use the Logisim-evolution board XML format.

## From Logisim-evolution (GPL-3.0)

Every file whose entry in `index.json` has `"origin": "evo"` (31 files) is copied unchanged, apart from line
endings, from Logisim-evolution v5.0.0:

- Repository: https://github.com/logisim-evolution/logisim-evolution
- Tag `v5.0.0`, commit `7c3343e134c6a1c304e5531ace503b01273d7fbc`
- Path: `src/main/resources/resources/logisim/boards/`
- License: GNU General Public License v3.0 (https://www.gnu.org/licenses/gpl-3.0.html)
- Copyright: the Logisim-evolution developers (see the repository's authors list)

## Made for Logic Design Studio

The files with `"origin": "lds"` were written for Logic Design Studio. Their pictures are drawings, not photos.
Their pins come from the vendors' master constraint files:

- `DIGILENT_NEXYS_A7_100T.xml`: Digilent `Nexys-A7-100T-Master.xdc` (https://github.com/Digilent/digilent-xdc)
- `TUL_PYNQ_Z2.xml`: TUL PYNQ-Z2 v1.0 master XDC

`index.json` lists every board, so the board list is available without loading the files. Keep it in step when
adding or changing a file.
