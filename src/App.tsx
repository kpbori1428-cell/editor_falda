import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Plus, Trash2, Layers, Settings, Image as ImageIcon, Loader2, Eye, EyeOff, ArrowUp, ArrowDown, FileImage, ZoomIn, ZoomOut, Maximize, Scissors, X, Check, ChevronDown, Move, ImagePlus, Copy } from 'lucide-react';
import { writePsd, readPsd } from 'ag-psd';
import { saveAs } from 'file-saver';

function CollapsibleSection({ title, icon, defaultOpen = true, children, accentColor = 'text-neutral-500', action }: { title: string, icon?: React.ReactNode, defaultOpen?: boolean, children: React.ReactNode, accentColor?: string, action?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full py-2 group"
      >
        <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${accentColor}`}>
          {icon}
          {title}
        </div>
        <div className="flex items-center gap-1">
          {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
          <ChevronDown className={`w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
        </div>
      </button>
      {isOpen && <div className="flex flex-col gap-3 pb-2">{children}</div>}
    </div>
  );
}

function ControlInput({ label, value, setValue, min, max, step = 1, unit = "", accentColor = "accent-white" }: any) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      setValue(val);
    } else if (e.target.value === '') {
      setValue('');
    }
  };

  const handleBlur = () => {
    if (value === '' || isNaN(value)) {
      setValue(min);
    } else if (value < min) {
      setValue(min);
    } else if (value > max) {
      setValue(max);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium text-neutral-400">{label}</label>
        <div className="flex items-center gap-1">
          <input 
            type="number" 
            min={min} max={max} step={step}
            value={value} 
            onChange={handleChange}
            onBlur={handleBlur}
            className="w-16 bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 text-right"
          />
          {unit && <span className="text-xs text-neutral-500 w-4">{unit}</span>}
        </div>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step} 
        value={value === '' ? min : value} 
        onChange={handleChange} 
        className={`w-full ${accentColor} h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer`} 
      />
    </div>
  );
}

// Flood fill on alpha channel — used by segmentation tool
function floodFillAlpha(imageData: ImageData, startX: number, startY: number, threshold = 10): boolean[] {
  const { width, height, data } = imageData;
  const totalPixels = width * height;
  const visited = new Array(totalPixels).fill(false);

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return visited;
  const startIdx = startY * width + startX;
  if (data[startIdx * 4 + 3] < threshold) return visited;

  const stack: number[] = [startIdx];
  visited[startIdx] = true;

  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];

    for (const nIdx of neighbors) {
      if (nIdx < 0 || visited[nIdx]) continue;
      if (data[nIdx * 4 + 3] < threshold) continue;
      visited[nIdx] = true;
      stack.push(nIdx);
    }
  }

  return visited;
}

type PlacementType = 'fill' | 'waist' | 'hem' | 'radial' | 'arc';

interface PatternLayer {
  id: string;
  name: string;
  imageSrc: string | null;
  imageObj: HTMLImageElement | null;
  imageWidthCm: number | '';
  spacingCm: number | '';
  rotationOffset: number | '';
  alternateRotation: number | '';
  mirrorAlternate: boolean;
  faceOutward: boolean;
  placementType: PlacementType;
  offsetCm: number | '';
  rings: number | '';
  ringSpacingCm: number | '';
  visible: boolean;
  opacity: number;
  angularOffset: number | '';
  raysCount: number | '';
  flipVertical: boolean;
}

const createDefaultLayer = (index: number): PatternLayer => ({
  id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
  name: `Capa ${index}`,
  imageSrc: null,
  imageObj: null,
  imageWidthCm: 8,
  spacingCm: 12,
  rotationOffset: 0,
  alternateRotation: 0,
  mirrorAlternate: false,
  faceOutward: true,
  placementType: 'fill',
  offsetCm: 0,
  rings: 1,
  ringSpacingCm: 5,
  visible: true,
  opacity: 100,
  angularOffset: 0,
  raysCount: 8,
  flipVertical: false,
});

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);

  // Viewport Settings
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  
  // Navigator Settings
  const [showNavigator, setShowNavigator] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 1000, S: 1000 });
  const [isMiniDragging, setIsMiniDragging] = useState(false);

  // Viewport Handlers
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    
    // Reverse delta depending on OS, but typically e.deltaY is positive for scrolling down (zooming out)
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    
    setScale((prevScale) => {
      const newScale = Math.min(Math.max(0.1, prevScale * (1 + delta)), 5); // Max 5x, Min 0.1x
      
      setPan((prevPan) => {
        const rect = containerRef.current!.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        
        const relX = px - rect.width / 2;
        const relY = py - rect.height / 2;
        
        return {
          x: relX - (newScale / prevScale) * (relX - prevPan.x),
          y: relY - (newScale / prevScale) * (relY - prevPan.y)
        };
      });
      
      return newScale;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({
          width,
          height,
          S: Math.min(width, height)
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const miniSize = 160; 
  const boxW = Math.max(2, (containerSize.width / scale) * (miniSize / containerSize.S));
  const boxH = Math.max(2, (containerSize.height / scale) * (miniSize / containerSize.S));
  const boxLeft = miniSize / 2 - (containerSize.width / 2 + pan.x) / scale * (miniSize / containerSize.S);
  const boxTop = miniSize / 2 - (containerSize.height / 2 + pan.y) / scale * (miniSize / containerSize.S);

  const updatePanFromMiniEvent = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let cursorMx = e.clientX - rect.left;
    let cursorMy = e.clientY - rect.top;
    
    const halfW = boxW / 2;
    const halfH = boxH / 2;
    
    // Restringir el cursor para que la caja roja (viewport) choque contra
    // los bordes del minimapa exacto como en Photoshop
    if (boxW <= miniSize) {
       cursorMx = Math.max(halfW, Math.min(miniSize - halfW, cursorMx));
    } else {
       cursorMx = miniSize / 2;
    }

    if (boxH <= miniSize) {
       cursorMy = Math.max(halfH, Math.min(miniSize - halfH, cursorMy));
    } else {
       cursorMy = miniSize / 2;
    }

    setPan({
      x: (miniSize / 2 - cursorMx) / (miniSize / containerSize.S) * scale,
      y: (miniSize / 2 - cursorMy) / (miniSize / containerSize.S) * scale
    });
  }, [containerSize.S, scale, miniSize, boxW, boxH]);

  const handleMiniPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setIsMiniDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePanFromMiniEvent(e);
  };
  const handleMiniPointerMove = (e: React.PointerEvent) => {
    if (!isMiniDragging) return;
    updatePanFromMiniEvent(e);
  };
  const handleMiniPointerUp = (e: React.PointerEvent) => {
    setIsMiniDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return; // Only left or middle click
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  
  const resetView = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };
  
  const zoomInView = () => {
    setScale(s => Math.min(s * 1.5, 5));
  };
  
  const zoomOutView = () => {
    setScale(s => Math.max(s / 1.5, 0.1));
  };

  // Global Settings
  const [waistCircumferenceCm, setWaistCircumferenceCm] = useState<number | ''>(70);
  const [skirtLengthCm, setSkirtLengthCm] = useState<number | ''>(50);
  const [fabricWidthCm, setFabricWidthCm] = useState<number | ''>(150);
  const [showFabricLimits, setShowFabricLimits] = useState(false);
  const [dpi, setDpi] = useState<number | ''>(150);
  const [bgColor, setBgColor] = useState<string>('transparent');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExportingPsd, setIsExportingPsd] = useState(false);

  // Layers State
  const [layers, setLayers] = useState<PatternLayer[]>([createDefaultLayer(1)]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(layers[0].id);

  // Safe values for calculations
  const safeWaist = Number(waistCircumferenceCm) || 70;
  const safeLength = Number(skirtLengthCm) || 50;
  const safeFabricWidth = Number(fabricWidthCm) || 150;
  
  // Derived dimensions
  const innerRadiusCm = safeWaist / (2 * Math.PI);
  const outerRadiusCm = innerRadiusCm + safeLength;
  const hemCircumferenceCm = 2 * Math.PI * outerRadiusCm;
  const canvasSizeCm = (outerRadiusCm + 2) * 2; // 2cm margin on all sides
  
  // Preview resolution
  const PREVIEW_DPI = 40;
  const previewPxPerCm = PREVIEW_DPI / 2.54;
  const previewCanvasWidth = Math.round(canvasSizeCm * previewPxPerCm);
  const previewCanvasHeight = Math.round(canvasSizeCm * previewPxPerCm);

  // Layer Management
  const addLayer = () => {
    const newLayer = createDefaultLayer(layers.length + 1);
    setLayers([...layers, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const updateLayer = (id: string, updates: Partial<PatternLayer>) => {
    setLayers(layers.map(layer => layer.id === id ? { ...layer, ...updates } : layer));
  };

  const deleteLayer = (id: string) => {
    const newLayers = layers.filter(l => l.id !== id);
    setLayers(newLayers);
    if (activeLayerId === id) {
      setActiveLayerId(newLayers.length > 0 ? newLayers[0].id : null);
    }
  };

  const duplicateLayer = (id: string) => {
    const source = layers.find(l => l.id === id);
    if (!source) return;
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const duplicate: PatternLayer = { ...source, id: newId, name: `${source.name} (copia)` };
    const idx = layers.findIndex(l => l.id === id);
    const newLayers = [...layers];
    newLayers.splice(idx + 1, 0, duplicate);
    setLayers(newLayers);
    setActiveLayerId(newId);
  };

  const moveLayerUp = (index: number) => {
    if (index === 0) return;
    const newLayers = [...layers];
    [newLayers[index - 1], newLayers[index]] = [newLayers[index], newLayers[index - 1]];
    setLayers(newLayers);
  };

  const moveLayerDown = (index: number) => {
    if (index === layers.length - 1) return;
    const newLayers = [...layers];
    [newLayers[index + 1], newLayers[index]] = [newLayers[index], newLayers[index + 1]];
    setLayers(newLayers);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, layerId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.psd')) {
      try {
        const buffer = await file.arrayBuffer();
        const psd = readPsd(buffer);
        
        const extractedLayers: { name: string, src: string, img: HTMLImageElement }[] = [];
        
        const extractCanvases = async (children: any[]) => {
          for (const child of children) {
            if (child.canvas) {
              const src = child.canvas.toDataURL('image/png');
              const img = new Image();
              await new Promise((resolve) => {
                img.onload = resolve;
                img.src = src;
              });
              extractedLayers.push({ name: child.name || 'Capa PSD', src, img });
            }
            if (child.children) {
              await extractCanvases(child.children);
            }
          }
        };

        if (psd.children) {
          await extractCanvases(psd.children);
        }

        if (extractedLayers.length > 0) {
          setLayers(prevLayers => {
            const newLayers = [...prevLayers];
            const activeIndex = newLayers.findIndex(l => l.id === layerId);
            
            if (activeIndex !== -1) {
              const baseSettings = { ...newLayers[activeIndex] };
              
              // Update the current layer with the first PSD layer
              newLayers[activeIndex] = {
                ...newLayers[activeIndex],
                name: extractedLayers[0].name,
                imageSrc: extractedLayers[0].src,
                imageObj: extractedLayers[0].img
              };
              
              // Add the rest of the PSD layers as new layers in the app
              for (let i = 1; i < extractedLayers.length; i++) {
                const newLayerId = Date.now().toString() + Math.random().toString(36).substr(2, 9) + i;
                newLayers.push({
                  ...baseSettings, // Inherit placement settings
                  id: newLayerId,
                  name: extractedLayers[i].name,
                  imageSrc: extractedLayers[i].src,
                  imageObj: extractedLayers[i].img
                });
              }
            }
            return newLayers;
          });
        } else if (psd.canvas) {
          // Fallback to composite image if no individual layer canvases found
          const src = psd.canvas.toDataURL('image/png');
          const img = new Image();
          img.onload = () => {
            updateLayer(layerId, { imageSrc: src, imageObj: img });
          };
          img.src = src;
        } else {
          alert("No se encontraron capas rasterizadas en el PSD.");
        }
      } catch (err) {
        console.error("Error reading PSD:", err);
        alert("Error al leer el archivo PSD. Asegúrate de que sea un archivo válido.");
      }
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target?.result as string;
        const img = new Image();
        img.onload = () => {
          updateLayer(layerId, { imageSrc: src, imageObj: img });
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    }
    
    // Reset input so the same file can be selected again if needed
    e.target.value = '';
  };

  const drawGuides = useCallback((ctx: CanvasRenderingContext2D, targetDpi: number, width: number, height: number) => {
    const currentPxPerCm = targetDpi / 2.54;
    const cx = width / 2;
    const cy = height / 2;
    const innerRadiusPx = innerRadiusCm * currentPxPerCm;
    const outerRadiusPx = outerRadiusCm * currentPxPerCm;

    // Fabric Limits
    if (showFabricLimits) {
      const fabricWidthPx = safeFabricWidth * currentPxPerCm;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.05)'; // red-500 very light
      ctx.fillRect(cx - fabricWidthPx / 2, 0, fabricWidthPx, height);
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // red-500
      ctx.lineWidth = Math.max(1, 2 * (targetDpi / 150));
      ctx.setLineDash([20 * (targetDpi / 150), 10 * (targetDpi / 150)]);
      ctx.beginPath();
      ctx.moveTo(cx - fabricWidthPx / 2, 0);
      ctx.lineTo(cx - fabricWidthPx / 2, height);
      ctx.moveTo(cx + fabricWidthPx / 2, 0);
      ctx.lineTo(cx + fabricWidthPx / 2, height);
      ctx.stroke();
    }

    // Skirt Guides
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // blue-500
    ctx.lineWidth = Math.max(1, 2 * (targetDpi / 150));
    ctx.setLineDash([10 * (targetDpi / 150), 10 * (targetDpi / 150)]);

    ctx.beginPath();
    ctx.arc(cx, cy, innerRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, outerRadiusPx, 0, Math.PI * 2);
    ctx.stroke();

    const crosshairSize = 15 * (targetDpi / 150);
    ctx.beginPath();
    ctx.moveTo(cx - crosshairSize, cy);
    ctx.lineTo(cx + crosshairSize, cy);
    ctx.moveTo(cx, cy - crosshairSize);
    ctx.lineTo(cx, cy + crosshairSize);
    ctx.stroke();

    ctx.setLineDash([]);
  }, [innerRadiusCm, outerRadiusCm, showFabricLimits, safeFabricWidth]);

  const drawSingleLayer = useCallback((ctx: CanvasRenderingContext2D, layer: PatternLayer, targetDpi: number, width: number, height: number) => {
    if (!layer.imageObj || !layer.visible) return;

    const currentPxPerCm = targetDpi / 2.54;
    const cx = width / 2;
    const cy = height / 2;
    const innerRadiusPx = innerRadiusCm * currentPxPerCm;
    const outerRadiusPx = outerRadiusCm * currentPxPerCm;

    const imgW = layer.imageObj.width;
    const imgH = layer.imageObj.height;
    
    const safeImageWidth = Number(layer.imageWidthCm) || 8;
    const safeRings = Number(layer.rings) || 1;
    const safeSpacing = Number(layer.spacingCm) || 12;
    const safeRotOffset = Number(layer.rotationOffset) || 0;
    const safeAltRot = Number(layer.alternateRotation) || 0;
    const safeOffset = Number(layer.offsetCm) || 0;
    const safeRingSpacing = Number(layer.ringSpacingCm) || 5;
    const safeAngularOffset = Number(layer.angularOffset) || 0;
    const safeRaysCount = Number(layer.raysCount) || 8;

    const imageWidthPx = safeImageWidth * currentPxPerCm;
    const scale = imageWidthPx / imgW;
    const scaleY = scale * (layer.flipVertical ? -1 : 1);
    const spacingPx = safeSpacing * currentPxPerCm;
    const offsetPx = safeOffset * currentPxPerCm;
    const ringSpacingPx = safeRingSpacing * currentPxPerCm;

    ctx.globalAlpha = layer.opacity / 100;

    if (layer.placementType === 'radial') {
      const startOffset = innerRadiusPx + offsetPx;
      
      for (let r = 0; r < safeRaysCount; r++) {
        const angle = (r / safeRaysCount) * Math.PI * 2 + (safeRotOffset * Math.PI / 180) + (safeAngularOffset * Math.PI / 180);
        
        for (let i = 0; i < safeRings; i++) { // Using rings as items per ray
          const currentRadiusPx = startOffset + (i * spacingPx);
          if (currentRadiusPx <= 0) continue;

          const x = cx + Math.cos(angle) * currentRadiusPx;
          const y = cy + Math.sin(angle) * currentRadiusPx;

          const isAlternate = r % 2 !== 0; // Alternate by ray
          const currentRot = safeRotOffset + (isAlternate ? safeAltRot : 0);
          const currentScaleX = scale * (layer.mirrorAlternate && isAlternate ? -1 : 1);

          ctx.save();
          ctx.translate(x, y);
          if (layer.faceOutward) {
            ctx.rotate(angle + Math.PI / 2 + (isAlternate ? safeAltRot * Math.PI / 180 : 0));
          } else {
            ctx.rotate(currentRot * Math.PI / 180);
          }
          ctx.scale(currentScaleX, scaleY);
          ctx.drawImage(layer.imageObj, -imgW / 2, -imgH / 2);
          ctx.restore();
        }
      }
    } else if (layer.placementType === 'arc') {
      // Arc mode: bend the image along the circumference by slicing into thin strips
      for (let l = 0; l < safeRings; l++) {
        let currentRadiusPx = innerRadiusPx + offsetPx + (l * ringSpacingPx);
        if (currentRadiusPx <= 0) continue;

        // Arc angle the image covers at this radius
        const arcAngle = imageWidthPx / currentRadiusPx;
        const baseAngle = (safeRotOffset * Math.PI / 180) + (safeAngularOffset * Math.PI / 180);
        const startAngle = baseAngle - arcAngle / 2;

        // Slice source image into thin vertical strips
        const sliceWidthSrc = 2; // 2 source pixels per slice
        const sliceCount = Math.ceil(imgW / sliceWidthSrc);
        const anglePerSlice = arcAngle / sliceCount;
        const renderedSliceWidth = (sliceWidthSrc * scale) + 0.5; // slight overlap to avoid gaps
        const renderedHeight = imgH * scale;

        for (let s = 0; s < sliceCount; s++) {
          const sx = s * sliceWidthSrc;
          const actualSliceWidth = Math.min(sliceWidthSrc, imgW - sx);
          const sliceAngle = startAngle + (s + 0.5) * anglePerSlice;

          const x = cx + Math.cos(sliceAngle) * currentRadiusPx;
          const y = cy + Math.sin(sliceAngle) * currentRadiusPx;

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(sliceAngle + Math.PI / 2);
          if (layer.flipVertical) ctx.scale(1, -1);
          ctx.drawImage(
            layer.imageObj,
            sx, 0, actualSliceWidth, imgH,
            -renderedSliceWidth / 2, -renderedHeight / 2, renderedSliceWidth, renderedHeight
          );
          ctx.restore();
        }
      }
    } else {
      // Concentric Rings Logic (Fill, Waist, Hem)
      for (let l = 0; l < safeRings; l++) {
        let currentRadiusPx;

        if (layer.placementType === 'fill') {
          if (safeRings === 1) {
              currentRadiusPx = innerRadiusPx + (outerRadiusPx - innerRadiusPx) / 2;
          } else {
              const availableSpace = outerRadiusPx - innerRadiusPx;
              const step = availableSpace / safeRings;
              currentRadiusPx = innerRadiusPx + step / 2 + l * step;
          }
        } else if (layer.placementType === 'waist') {
          currentRadiusPx = innerRadiusPx + offsetPx + (l * ringSpacingPx);
        } else if (layer.placementType === 'hem') {
          currentRadiusPx = outerRadiusPx - offsetPx - (l * ringSpacingPx);
        } else {
          currentRadiusPx = innerRadiusPx;
        }

        if (currentRadiusPx <= 0) continue;

        const circumference = 2 * Math.PI * currentRadiusPx;
        const currentCount = Math.max(1, Math.floor(circumference / spacingPx));
        
        for (let i = 0; i < currentCount; i++) {
          const ringOffset = (l % 2 === 1) ? (Math.PI * 2 / currentCount) / 2 : 0;
          const angle = (i / currentCount) * Math.PI * 2 + (safeRotOffset * Math.PI / 180) + ringOffset + (safeAngularOffset * Math.PI / 180);
          
          const x = cx + Math.cos(angle) * currentRadiusPx;
          const y = cy + Math.sin(angle) * currentRadiusPx;

          const isAlternate = i % 2 !== 0;
          const currentRot = safeRotOffset + (isAlternate ? safeAltRot : 0);
          const currentScaleX = scale * (layer.mirrorAlternate && isAlternate ? -1 : 1);

          ctx.save();
          ctx.translate(x, y);
          if (layer.faceOutward) {
            ctx.rotate(angle + Math.PI / 2 + (isAlternate ? safeAltRot * Math.PI / 180 : 0));
          } else {
            ctx.rotate(currentRot * Math.PI / 180);
          }
          ctx.scale(currentScaleX, scaleY);
          ctx.drawImage(layer.imageObj, -imgW / 2, -imgH / 2);
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1.0; // Reset
  }, [innerRadiusCm, outerRadiusCm]);

  const renderPattern = useCallback((canvas: HTMLCanvasElement, targetDpi: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawGuides(ctx, targetDpi, canvas.width, canvas.height);

    // Draw layers from bottom to top (index 0 is bottom)
    for (let i = layers.length - 1; i >= 0; i--) {
      drawSingleLayer(ctx, layers[i], targetDpi, canvas.width, canvas.height);
    }
  }, [layers, bgColor, drawGuides, drawSingleLayer]);

  const MINI_DPI = 5;
  const miniCanvasSize = Math.round(canvasSizeCm * (MINI_DPI / 2.54));

  useEffect(() => {
    if (canvasRef.current) {
      renderPattern(canvasRef.current, PREVIEW_DPI);
    }
    if (miniCanvasRef.current && showNavigator) {
      renderPattern(miniCanvasRef.current, MINI_DPI);
    }
  }, [renderPattern, previewCanvasWidth, previewCanvasHeight, miniCanvasSize, showNavigator]);

  const downloadImage = () => {
    setIsDownloading(true);
    setTimeout(() => {
      try {
        const exportCanvas = document.createElement('canvas');
        const safeDpi = Number(dpi) || 150;
        const exportPxPerCm = safeDpi / 2.54;
        exportCanvas.width = Math.round(canvasSizeCm * exportPxPerCm);
        exportCanvas.height = Math.round(canvasSizeCm * exportPxPerCm);
        
        renderPattern(exportCanvas, safeDpi);
        
        const dataUrl = exportCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'skirt-pattern-composition.png';
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error("Failed to export image", err);
        alert("Failed to export image. The resolution might be too high for your browser. Try lowering the DPI.");
      } finally {
        setIsDownloading(false);
      }
    }, 50);
  };

  const exportForPhotoshop = async () => {
    setIsExportingPsd(true);
    try {
      const safeDpi = Number(dpi) || 150;
      const exportPxPerCm = safeDpi / 2.54;
      const width = Math.round(canvasSizeCm * exportPxPerCm);
      const height = Math.round(canvasSizeCm * exportPxPerCm);

      const psdChildren: any[] = [];

      // 1. Background Layer
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = width; bgCanvas.height = height;
      const bgCtx = bgCanvas.getContext('2d')!;
      if (bgColor !== 'transparent') {
        bgCtx.fillStyle = bgColor;
        bgCtx.fillRect(0, 0, width, height);
      }
      psdChildren.push({ name: 'Fondo', canvas: bgCanvas });

      // 2. Guides Layer
      const guidesCanvas = document.createElement('canvas');
      guidesCanvas.width = width; guidesCanvas.height = height;
      const gCtx = guidesCanvas.getContext('2d')!;
      drawGuides(gCtx, safeDpi, width, height);
      psdChildren.push({ name: 'Guias_Falda', canvas: guidesCanvas });

      // 3. Individual Pattern Layers (Bottom to Top)
      // ag-psd expects children in bottom-to-top order (index 0 is bottom)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!layer.imageObj) continue;
        
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = width; layerCanvas.height = height;
        const lCtx = layerCanvas.getContext('2d')!;
        
        // Draw with 100% opacity, we set opacity in PSD metadata
        const exportLayer = { ...layer, opacity: 100, visible: true };
        drawSingleLayer(lCtx, exportLayer, safeDpi, width, height);
        
        psdChildren.push({
          name: layer.name,
          canvas: layerCanvas,
          opacity: layer.opacity / 100,
          hidden: !layer.visible
        });
      }

      const psd = {
        width,
        height,
        children: psdChildren
      };

      const buffer = writePsd(psd);
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      saveAs(blob, "Patron_Falda.psd");

    } catch (err) {
      console.error(err);
      alert("Error al exportar PSD.");
    } finally {
      setIsExportingPsd(false);
    }
  };

  const activeLayer = layers.find(l => l.id === activeLayerId);

  // Segmentation State
  const [segmentLayerId, setSegmentLayerId] = useState<string | null>(null);
  const [segmentSelections, setSegmentSelections] = useState<{mask: boolean[], color: string}[]>([]);
  const segmentCanvasRef = useRef<HTMLCanvasElement>(null);
  const segmentLayer = segmentLayerId ? layers.find(l => l.id === segmentLayerId) : null;

  const startSegmenting = (layerId: string) => {
    setSegmentLayerId(layerId);
    setSegmentSelections([]);
  };

  const handleSegmentClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!segmentLayer?.imageObj || !segmentCanvasRef.current) return;

    const canvas = segmentCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const sx = segmentLayer.imageObj.width / rect.width;
    const sy = segmentLayer.imageObj.height / rect.height;
    const clickX = Math.floor((e.clientX - rect.left) * sx);
    const clickY = Math.floor((e.clientY - rect.top) * sy);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = segmentLayer.imageObj.width;
    tempCanvas.height = segmentLayer.imageObj.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(segmentLayer.imageObj, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

    // Check if clicking on an already selected region → deselect
    for (let idx = 0; idx < segmentSelections.length; idx++) {
      if (segmentSelections[idx].mask[clickY * tempCanvas.width + clickX]) {
        setSegmentSelections(prev => prev.filter((_, i) => i !== idx));
        return;
      }
    }

    const mask = floodFillAlpha(imageData, clickX, clickY);
    if (!mask.some(v => v)) return; // clicked transparent

    const colors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];
    const color = colors[segmentSelections.length % colors.length];
    setSegmentSelections(prev => [...prev, { mask, color }]);
  };

  const confirmSegmentation = async () => {
    if (!segmentLayer?.imageObj) return;

    const imgW = segmentLayer.imageObj.width;
    const imgH = segmentLayer.imageObj.height;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imgW;
    srcCanvas.height = imgH;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.drawImage(segmentLayer.imageObj, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, imgW, imgH);

    const newLayerPromises = segmentSelections.map(async (sel, i) => {
      let minX = imgW, minY = imgH, maxX = 0, maxY = 0;
      for (let j = 0; j < sel.mask.length; j++) {
        if (sel.mask[j]) {
          const x = j % imgW;
          const y = Math.floor(j / imgW);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d')!;
      const cropData = cropCtx.createImageData(cropW, cropH);

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const sIdx = (y * imgW + x) * 4;
          const dIdx = ((y - minY) * cropW + (x - minX)) * 4;
          if (sel.mask[y * imgW + x]) {
            cropData.data[dIdx] = srcData.data[sIdx];
            cropData.data[dIdx + 1] = srcData.data[sIdx + 1];
            cropData.data[dIdx + 2] = srcData.data[sIdx + 2];
            cropData.data[dIdx + 3] = srcData.data[sIdx + 3];
          }
        }
      }
      cropCtx.putImageData(cropData, 0, 0);
      const src = cropCanvas.toDataURL('image/png');

      const img = await new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = src;
      });

      return {
        ...segmentLayer,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9) + i,
        name: `${segmentLayer.name} - ${i + 1}`,
        imageSrc: src,
        imageObj: img,
      };
    });

    const newLayers = await Promise.all(newLayerPromises);
    setLayers(prev => [...prev, ...newLayers]);
    setSegmentLayerId(null);
    setSegmentSelections([]);
  };

  // Draw segmentation preview canvas
  useEffect(() => {
    if (!segmentLayer?.imageObj || !segmentCanvasRef.current) return;
    const canvas = segmentCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const imgW = segmentLayer.imageObj.width;
    const imgH = segmentLayer.imageObj.height;
    canvas.width = imgW;
    canvas.height = imgH;

    ctx.drawImage(segmentLayer.imageObj, 0, 0);

    if (segmentSelections.length > 0) {
      const imageData = ctx.getImageData(0, 0, imgW, imgH);
      for (const sel of segmentSelections) {
        const r = parseInt(sel.color.slice(1, 3), 16);
        const g = parseInt(sel.color.slice(3, 5), 16);
        const b = parseInt(sel.color.slice(5, 7), 16);
        for (let i = 0; i < sel.mask.length; i++) {
          if (sel.mask[i]) {
            const idx = i * 4;
            imageData.data[idx] = Math.round(imageData.data[idx] * 0.4 + r * 0.6);
            imageData.data[idx + 1] = Math.round(imageData.data[idx + 1] * 0.4 + g * 0.6);
            imageData.data[idx + 2] = Math.round(imageData.data[idx + 2] * 0.4 + b * 0.6);
            imageData.data[idx + 3] = Math.max(imageData.data[idx + 3], 180);
          }
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }
  }, [segmentLayer, segmentSelections]);

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col md:flex-row font-sans text-white">
      {/* Sidebar */}
      <div className="w-full md:w-96 bg-neutral-900 border-r border-neutral-800 flex flex-col h-screen shrink-0 shadow-sm z-10">
        
        <div className="p-5 border-b border-neutral-800 shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-white mb-1">Skirt Pattern Studio</h1>
          <p className="text-xs text-neutral-400">Composición multicapa para faldas circulares.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-2 divide-y divide-neutral-800">
          
          {/* Global Skirt Settings */}
          <CollapsibleSection title="Falda" icon={<Settings size={14} />} defaultOpen={false}>
            <div className="flex flex-col gap-3 bg-neutral-950/50 p-4 rounded-xl border border-neutral-800">
              <ControlInput label="Contorno de cintura" value={waistCircumferenceCm} setValue={setWaistCircumferenceCm} min={30} max={150} unit="cm" accentColor="accent-blue-500" />
              <ControlInput label="Largo de falda" value={skirtLengthCm} setValue={setSkirtLengthCm} min={10} max={120} unit="cm" accentColor="accent-blue-500" />
              
              <div className="flex justify-between items-center mt-2 pt-2 border-t border-neutral-800">
                <span className="text-xs text-neutral-400">Bajo de falda (Hem):</span>
                <span className="text-xs font-mono font-medium text-blue-400">{Math.round(hemCircumferenceCm)} cm</span>
              </div>

              <div className="mt-2 pt-3 border-t border-neutral-800 flex flex-col gap-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center w-4 h-4">
                    <input type="checkbox" checked={showFabricLimits} onChange={(e) => setShowFabricLimits(e.target.checked)} className="peer appearance-none w-4 h-4 border border-neutral-600 rounded bg-neutral-900 checked:bg-red-500 checked:border-red-500 transition-colors" />
                    <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <span className="text-xs font-medium text-neutral-300 group-hover:text-white transition-colors">Mostrar Límites de Tela</span>
                </label>
                {showFabricLimits && (
                  <ControlInput label="Ancho de la Tela" value={fabricWidthCm} setValue={setFabricWidthCm} min={50} max={300} unit="cm" accentColor="accent-red-500" />
                )}
              </div>
            </div>
          </CollapsibleSection>

          {/* Layers Manager */}
          <CollapsibleSection 
            title="Capas" 
            icon={<Layers size={14} />} 
            defaultOpen={true}
            action={
              <button 
                onClick={addLayer}
                className="text-xs bg-neutral-800 hover:bg-neutral-700 text-white px-2 py-1 rounded flex items-center gap-1 transition-colors border border-neutral-700"
              >
                <Plus size={12} /> Nueva
              </button>
            }
          >
            <div className="flex flex-col gap-2">
              {layers.map((layer, index) => (
                <div 
                  key={layer.id} 
                  onClick={() => setActiveLayerId(layer.id)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${activeLayerId === layer.id ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_10px_rgba(59,130,246,0.1)]' : 'border-neutral-800 bg-neutral-950/50 hover:border-neutral-600'} ${!layer.visible ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                      className="p-1 text-neutral-400 hover:text-white transition-colors"
                    >
                      {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                    <div className="w-8 h-8 bg-neutral-900 rounded flex items-center justify-center border border-neutral-800 overflow-hidden shrink-0">
                      {layer.imageSrc ? (
                        <img src={layer.imageSrc} alt="thumbnail" className="w-full h-full object-contain p-1" />
                      ) : (
                        <ImageIcon size={14} className="text-neutral-600" />
                      )}
                    </div>
                    <div className="flex flex-col w-24">
                      <input 
                        type="text" 
                        value={layer.name} 
                        onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-neutral-200 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-blue-500 rounded px-1 -ml-1"
                      />
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{layer.placementType}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col">
                      <button onClick={(e) => { e.stopPropagation(); moveLayerUp(index); }} disabled={index === 0} className="p-0.5 text-neutral-500 hover:text-white disabled:opacity-30"><ArrowUp size={12}/></button>
                      <button onClick={(e) => { e.stopPropagation(); moveLayerDown(index); }} disabled={index === layers.length - 1} className="p-0.5 text-neutral-500 hover:text-white disabled:opacity-30"><ArrowDown size={12}/></button>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }}
                      className="p-1.5 text-neutral-500 hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                      title="Duplicar capa"
                    >
                      <Copy size={14} />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                      className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Eliminar capa"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {layers.length === 0 && (
                <div className="text-center p-4 text-sm text-neutral-500 border border-dashed border-neutral-800 rounded-lg">
                  No hay capas. Agrega una para comenzar.
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Active Layer Settings */}
          {activeLayer && (
            <>
              {/* Image Section */}
              <CollapsibleSection title="Imagen" icon={<ImagePlus size={14} />} defaultOpen={true} accentColor="text-blue-400">
                <label className="flex flex-col items-center justify-center w-full h-24 border border-dashed border-neutral-700 rounded-xl cursor-pointer bg-neutral-950 hover:bg-neutral-800 hover:border-blue-500 transition-all group">
                  <div className="flex items-center justify-center gap-3">
                    {activeLayer.imageSrc ? (
                      <img src={activeLayer.imageSrc} alt="Preview" className="h-16 object-contain drop-shadow-md" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-900 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:text-blue-400 transition-colors">
                        <Upload className="w-5 h-5 text-neutral-500 group-hover:text-blue-400" />
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-sm text-neutral-300 font-medium">{activeLayer.imageSrc ? 'Cambiar Imagen' : 'Subir PNG/PSD'}</span>
                      <span className="text-xs text-neutral-500">Extrae todas las capas</span>
                    </div>
                  </div>
                  <input type="file" className="hidden" accept="image/png, image/jpeg, .psd, application/x-photoshop, image/vnd.adobe.photoshop" onChange={(e) => handleImageUpload(e, activeLayer.id)} />
                </label>
                {activeLayer.imageSrc && (
                  <button
                    onClick={() => startSegmenting(activeLayer.id)}
                    className="w-full py-2 px-3 bg-neutral-950 text-neutral-300 hover:text-white hover:bg-neutral-800 border border-neutral-700 hover:border-amber-500 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    Segmentar Elementos
                  </button>
                )}
              </CollapsibleSection>

              {/* Placement Section */}
              <CollapsibleSection title="Distribución" icon={<Layers size={14} />} defaultOpen={true} accentColor="text-blue-400">
                <div className="flex flex-col gap-3 bg-neutral-950/50 p-4 rounded-xl border border-neutral-800">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-neutral-400">Tipo de distribución</label>
                    <select 
                      value={activeLayer.placementType}
                      onChange={(e) => updateLayer(activeLayer.id, { placementType: e.target.value as PlacementType })}
                      className="w-full bg-neutral-900 border border-neutral-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
                    >
                      <option value="fill">Llenar toda la falda</option>
                      <option value="waist">Contorno desde la Cintura</option>
                      <option value="hem">Contorno desde el Ruedo</option>
                      <option value="radial">Radial (Rayos desde el centro)</option>
                      <option value="arc">Arco (Curvar sobre circunferencia)</option>
                    </select>
                  </div>

                  {(activeLayer.placementType === 'waist' || activeLayer.placementType === 'hem' || activeLayer.placementType === 'radial' || activeLayer.placementType === 'arc') && (
                    <ControlInput 
                      label={`Distancia desde ${activeLayer.placementType === 'waist' || activeLayer.placementType === 'radial' || activeLayer.placementType === 'arc' ? 'Cintura' : 'Ruedo'}`} 
                      value={activeLayer.offsetCm} 
                      setValue={(v: number) => updateLayer(activeLayer.id, { offsetCm: v })} 
                      min={-20} max={100} step={0.5} unit="cm" 
                    />
                  )}

                  {activeLayer.placementType === 'radial' ? (
                    <>
                      <ControlInput 
                        label="Cantidad de Rayos" 
                        value={activeLayer.raysCount} 
                        setValue={(v: number) => updateLayer(activeLayer.id, { raysCount: v })} 
                        min={1} max={60} 
                      />
                      <ControlInput 
                        label="Figuras por Rayo" 
                        value={activeLayer.rings} 
                        setValue={(v: number) => updateLayer(activeLayer.id, { rings: v })} 
                        min={1} max={50} 
                      />
                    </>
                  ) : (
                    <ControlInput 
                      label={activeLayer.placementType === 'fill' ? "Cantidad de líneas (Rings)" : "Repetir contorno (Líneas)"} 
                      value={activeLayer.rings} 
                      setValue={(v: number) => updateLayer(activeLayer.id, { rings: v })} 
                      min={1} max={20} 
                    />
                  )}

                  {Number(activeLayer.rings) > 1 && (activeLayer.placementType === 'waist' || activeLayer.placementType === 'hem' || activeLayer.placementType === 'arc') && (
                    <ControlInput 
                      label="Separación entre líneas" 
                      value={activeLayer.ringSpacingCm} 
                      setValue={(v: number) => updateLayer(activeLayer.id, { ringSpacingCm: v })} 
                      min={1} max={50} step={0.5} unit="cm" 
                    />
                  )}
                </div>
              </CollapsibleSection>

              {/* Transform Section */}
              <CollapsibleSection title="Transformar" icon={<Move size={14} />} defaultOpen={false} accentColor="text-blue-400">
                <div className="flex flex-col gap-3 bg-neutral-950/50 p-4 rounded-xl border border-neutral-800">
                  <ControlInput label="Opacidad" value={activeLayer.opacity} setValue={(v: number) => updateLayer(activeLayer.id, { opacity: v })} min={0} max={100} unit="%" accentColor="accent-blue-400" />
                  <ControlInput label="Ancho de la figura" value={activeLayer.imageWidthCm} setValue={(v: number) => updateLayer(activeLayer.id, { imageWidthCm: v })} min={1} max={50} step={0.5} unit="cm" />
                  <ControlInput label={activeLayer.placementType === 'radial' ? "Separación en el rayo" : "Separación entre figuras"} value={activeLayer.spacingCm} setValue={(v: number) => updateLayer(activeLayer.id, { spacingCm: v })} min={1} max={50} step={0.5} unit="cm" />
                  <ControlInput label="Desfase Angular (Inicio)" value={activeLayer.angularOffset} setValue={(v: number) => updateLayer(activeLayer.id, { angularOffset: v })} min={0} max={360} unit="°" />
                  <ControlInput label="Rotación Global" value={activeLayer.rotationOffset} setValue={(v: number) => updateLayer(activeLayer.id, { rotationOffset: v })} min={0} max={360} unit="°" />
                  <ControlInput label="Rotación Alterna" value={activeLayer.alternateRotation} setValue={(v: number) => updateLayer(activeLayer.id, { alternateRotation: v })} min={0} max={360} unit="°" />

                  <div className="flex flex-col gap-2 mt-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center w-4 h-4">
                        <input type="checkbox" checked={activeLayer.mirrorAlternate} onChange={(e) => updateLayer(activeLayer.id, { mirrorAlternate: e.target.checked })} className="peer appearance-none w-4 h-4 border border-neutral-600 rounded bg-neutral-900 checked:bg-blue-500 checked:border-blue-500 transition-colors" />
                        <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                      <span className="text-xs font-medium text-neutral-300 group-hover:text-white transition-colors">Espejar figuras alternas</span>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center w-4 h-4">
                        <input type="checkbox" checked={activeLayer.faceOutward} onChange={(e) => updateLayer(activeLayer.id, { faceOutward: e.target.checked })} className="peer appearance-none w-4 h-4 border border-neutral-600 rounded bg-neutral-900 checked:bg-blue-500 checked:border-blue-500 transition-colors" />
                        <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                      <span className="text-xs font-medium text-neutral-300 group-hover:text-white transition-colors">Orientar hacia afuera (Curva)</span>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center justify-center w-4 h-4">
                        <input type="checkbox" checked={activeLayer.flipVertical} onChange={(e) => updateLayer(activeLayer.id, { flipVertical: e.target.checked })} className="peer appearance-none w-4 h-4 border border-neutral-600 rounded bg-neutral-900 checked:bg-blue-500 checked:border-blue-500 transition-colors" />
                        <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                      <span className="text-xs font-medium text-neutral-300 group-hover:text-white transition-colors">Invertir verticalmente</span>
                    </label>
                  </div>
                </div>
              </CollapsibleSection>
            </>
          )}
        </div>

        {/* Export Actions (Sticky Bottom) */}
        <div className="p-5 border-t border-neutral-800 bg-neutral-900 shrink-0 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Fondo de Exportación</label>
            <div className="flex gap-2">
              {[
                { id: 'transparent', color: 'transparent' },
                { id: 'white', color: '#ffffff' },
                { id: 'black', color: '#000000' },
                { id: 'gray', color: '#374151' },
                { id: 'yellow', color: '#fef08a' },
                { id: 'blue', color: '#bfdbfe' },
                { id: 'pink', color: '#fbcfe8' },
              ].map(bg => (
                <button
                  key={bg.id}
                  onClick={() => setBgColor(bg.color)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${bgColor === bg.color ? 'border-white scale-110' : 'border-neutral-700 shadow-sm'}`}
                  style={{ 
                    backgroundColor: bg.color === 'transparent' ? '#171717' : bg.color, 
                    backgroundImage: bg.color === 'transparent' ? 'linear-gradient(45deg, #262626 25%, transparent 25%), linear-gradient(-45deg, #262626 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262626 75%), linear-gradient(-45deg, transparent 75%, #262626 75%)' : 'none', 
                    backgroundSize: '8px 8px', 
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px' 
                  }}
                  title={bg.id}
                />
              ))}
            </div>
          </div>
          
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5 w-24 shrink-0">
              <label className="text-xs font-medium text-neutral-400">DPI Final</label>
              <input 
                type="number" 
                min="72" max="600" 
                value={dpi} 
                onChange={(e) => setDpi(e.target.value === '' ? '' : Number(e.target.value))} 
                onBlur={() => {
                  if (dpi === '' || Number(dpi) < 72) setDpi(72);
                  if (Number(dpi) > 600) setDpi(600);
                }}
                className="w-full px-2 py-1.5 border border-neutral-700 bg-neutral-950 text-white rounded-lg text-sm focus:outline-none focus:border-blue-500" 
              />
            </div>
            <div className="flex flex-col gap-2 flex-1">
              <button
                onClick={downloadImage}
                disabled={layers.every(l => !l.imageSrc) || isDownloading || isExportingPsd}
                className="w-full py-2 px-3 bg-neutral-800 text-white hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border border-neutral-700"
              >
                {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PNG Combinado
              </button>
              <button
                onClick={exportForPhotoshop}
                disabled={layers.every(l => !l.imageSrc) || isDownloading || isExportingPsd}
                className="w-full py-2 px-3 bg-blue-600 text-white hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-blue-900/20"
              >
                {isExportingPsd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileImage className="w-3.5 h-3.5" />}
                Exportar PSD (Capas)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 bg-neutral-950 relative overflow-hidden flex items-center justify-center p-8">
        <div className="absolute inset-0 opacity-20 pointer-events-none z-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
        
        {/* Top Right UI Overlay */}
        <div className="absolute top-4 right-4 flex items-start gap-3 z-20">
          
          {/* Minimap / Navigator */}
          {showNavigator && (
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-2 shadow-xl flex flex-col gap-2">
              <div className="flex justify-between items-center px-1">
                <span className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase">Navegador</span>
              </div>
              <div 
                className="relative bg-neutral-950 rounded border border-neutral-800 overflow-hidden cursor-crosshair touch-none"
                style={{ width: miniSize, height: miniSize }}
                onPointerDown={handleMiniPointerDown}
                onPointerMove={handleMiniPointerMove}
                onPointerUp={handleMiniPointerUp}
                onPointerCancel={handleMiniPointerUp}
              >
                <canvas 
                  ref={miniCanvasRef} 
                  width={miniCanvasSize}
                  height={miniCanvasSize}
                  className="w-full h-full object-contain pointer-events-none"
                  style={{ 
                    backgroundColor: bgColor === 'transparent' ? 'rgba(23, 23, 23, 0.5)' : bgColor,
                    backgroundImage: bgColor === 'transparent' ? 'linear-gradient(45deg, #262626 25%, transparent 25%), linear-gradient(-45deg, #262626 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262626 75%), linear-gradient(-45deg, transparent 75%, #262626 75%)' : 'none',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                  }}
                />
                {/* Red Box Marker */}
                <div 
                  className="absolute border border-red-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] pointer-events-none"
                  style={{
                    left: `${boxLeft}px`,
                    top: `${boxTop}px`,
                    width: `${boxW}px`,
                    height: `${boxH}px`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Viewport Controls */}
          <div className="flex flex-col gap-2">
            <button onClick={() => setShowNavigator(!showNavigator)} className="w-10 h-10 bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg flex items-center justify-center transition-colors shadow-lg group" title="Ocultar/Mostrar Navegador">
              {showNavigator ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={zoomInView} className="w-10 h-10 bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg flex items-center justify-center transition-colors shadow-lg group" title="Acercar">
              <ZoomIn className="w-5 h-5" />
            </button>
            <button onClick={resetView} className="w-10 h-10 bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg flex items-center justify-center transition-colors shadow-lg group" title="Restaurar Visión">
              <Maximize className="w-5 h-5" />
            </button>
            <button onClick={zoomOutView} className="w-10 h-10 bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg flex items-center justify-center transition-colors shadow-lg group" title="Alejar">
              <ZoomOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div 
          ref={containerRef}
          className={`relative w-full h-full flex items-center justify-center overflow-hidden touch-none z-10 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div 
            className="relative shadow-2xl ring-1 ring-white/10 origin-center" 
            style={{ 
              width: `${containerSize.S}px`, 
              height: `${containerSize.S}px`, 
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transition: isDragging ? 'none' : 'transform 0.1s cubic-bezier(0.2, 0, 0, 1)'
            }}
          >
             <canvas
                ref={canvasRef}
                width={previewCanvasWidth}
                height={previewCanvasHeight}
                className="w-full h-full pointer-events-none relative"
                style={{ 
                  backgroundColor: bgColor === 'transparent' ? 'rgba(23, 23, 23, 0.5)' : bgColor,
                  backgroundImage: bgColor === 'transparent' ? 'linear-gradient(45deg, #262626 25%, transparent 25%), linear-gradient(-45deg, #262626 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262626 75%), linear-gradient(-45deg, transparent 75%, #262626 75%)' : 'none',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                  aspectRatio: `${previewCanvasWidth} / ${previewCanvasHeight}`
                }}
              />
          </div>
        </div>
      </div>

      {/* Segmentation Modal */}
      {segmentLayer && segmentLayer.imageObj && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-8">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl flex flex-col max-w-4xl max-h-full w-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-white">Segmentar: {segmentLayer.name}</span>
                <span className="text-xs text-neutral-400">Clic en un elemento para seleccionarlo. Clic de nuevo para deseleccionar.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{segmentSelections.length} seleccionado{segmentSelections.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={confirmSegmentation}
                  disabled={segmentSelections.length === 0}
                  className="py-1.5 px-3 bg-green-600 hover:bg-green-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> Confirmar
                </button>
                <button
                  onClick={() => { setSegmentLayerId(null); setSegmentSelections([]); }}
                  className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {/* Canvas */}
            <div className="flex-1 overflow-auto p-6 flex items-center justify-center" style={{ background: 'linear-gradient(45deg, #1a1a1a 25%, transparent 25%), linear-gradient(-45deg, #1a1a1a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1a1a 75%), linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px', backgroundColor: '#111' }}>
              <canvas
                ref={segmentCanvasRef}
                onClick={handleSegmentClick}
                className="max-w-full max-h-full object-contain cursor-crosshair drop-shadow-2xl"
                style={{ imageRendering: 'auto' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
