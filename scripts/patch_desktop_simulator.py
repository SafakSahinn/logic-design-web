import os
import re

target_file = r"C:\Users\safak\Desktop\Logic Design Studio\src\components\LogisimSimulator.tsx"

with open(target_file, "r", encoding="utf-8") as f:
    code = f.read()

# 1. Add imports for StandaloneKMapSolver and StandaloneNumberConverter, and icons
import_snippet = """import { StandaloneKMapSolver } from './StandaloneKMapSolver';
import { StandaloneNumberConverter } from './StandaloneNumberConverter';
import {
  FolderOpen,
  Save,
  HelpCircle,
  PanelLeftClose,
  PanelLeft,
  Info,
} from 'lucide-react';
"""

if "StandaloneKMapSolver" not in code:
    code = import_snippet + code

# 2. Add interface LogicCircuitSimulatorProps
old_decl = "export const LogicCircuitSimulator: React.FC = () => {"
new_decl = """export interface LogicCircuitSimulatorProps {
  desktopMode?: boolean;
}

export const LogicCircuitSimulator: React.FC<LogicCircuitSimulatorProps> = ({ desktopMode = false }) => {"""

if old_decl in code:
    code = code.replace(old_decl, new_decl)

# 3. Add desktop state & helper definitions
desktop_state_snippet = """
  // Desktop Application State & Modals
  const [activeDesktopMenu, setActiveDesktopMenu] = useState<'file' | 'edit' | 'simulate' | 'tools' | 'view' | 'help' | null>(null);
  const [showKMapModal, setShowKMapModal] = useState<boolean>(false);
  const [showNumberConverterModal, setShowNumberConverterModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [showLeftToolbox, setShowLeftToolbox] = useState<boolean>(true);
  const [desktopToolboxSearch, setDesktopToolboxSearch] = useState<string>('');
  const [toolboxCategoryOpen, setToolboxCategoryOpen] = useState<Record<string, boolean>>({
    wiring: true,
    gates: true,
    inputs: true,
    outputs: true,
    combinational: false,
    sequential: false,
    peripherals: false,
    custom: false,
  });

  const toggleToolboxCategory = (catId: string) => {
    setToolboxCategoryOpen((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  useEffect(() => {
    if (!activeDesktopMenu) return;
    const handleClose = () => setActiveDesktopMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [activeDesktopMenu]);

  // Handle Drag & Drop to canvas
  const handleCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const compType = e.dataTransfer.getData('application/component-type') as ComponentType;
    if (!compType) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const posX = Math.round((clientX - panOffset.x) / zoom / 20) * 20;
    const posY = Math.round((clientY - panOffset.y) / zoom / 20) * 20;

    recordHistory();
    const newComp = updatePinPositions(createComponentInstance(compType, posX, posY));
    setComponents((prev) => {
      const updated = [...prev, newComp];
      const sim = simulateCircuit(updated, wires);
      setWires(sim.wires);
      return sim.components;
    });
    setSelectedCompId(newComp.id);
    setSelectedWireId(null);
    setToastMessage(`${newComp.name} tuvale yerleştirildi`);
    setTimeout(() => setToastMessage(null), 1800);
  };
"""

state_marker = "const [cadTheme, setCadTheme] = useState<'light' | 'dark'>"
if state_marker in code and "activeDesktopMenu" not in code:
    code = code.replace(state_marker, desktop_state_snippet + "\n  " + state_marker)

print("Imports and state injected successfully.")

with open(target_file, "w", encoding="utf-8") as f:
    f.write(code)
