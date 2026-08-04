import { useState, useRef, useEffect, useCallback } from 'react'

// Misma proporción que el recuadro de la planilla (160 x 49 = 3.265:1),
// pero renderizado a mayor resolución (x3) para que no se vea pixelado al imprimir.
const OUT_W = 480
const OUT_H = 147

export default function FirmaEditorModal({ file, onCancel, onConfirm }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 })
  const [listo, setListo] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      // Zoom inicial: que la imagen cubra todo el recuadro (comportamiento "cover")
      const scaleParaCubrir = Math.max(OUT_W / img.width, OUT_H / img.height)
      setZoom(scaleParaCubrir)
      setOffset({ x: 0, y: 0 })
      setListo(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const dibujar = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT_W, OUT_H)

    const w = img.width * zoom
    const h = img.height * zoom
    const x = (OUT_W - w) / 2 + offset.x
    const y = (OUT_H - h) / 2 + offset.y
    ctx.drawImage(img, x, y, w, h)
  }, [zoom, offset])

  useEffect(() => { if (listo) dibujar() }, [listo, dibujar])

  function handleWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setZoom(z => Math.max(0.05, Math.min(z + delta, 5)))
  }

  function handleDown(e) {
    setDragging(true)
    const p = e.touches ? e.touches[0] : e
    setLastPos({ x: p.clientX, y: p.clientY })
  }

  function handleMove(e) {
    if (!dragging) return
    const p = e.touches ? e.touches[0] : e
    const dx = p.clientX - lastPos.x
    const dy = p.clientY - lastPos.y
    setLastPos({ x: p.clientX, y: p.clientY })
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }))
  }

  function handleUp() { setDragging(false) }

  function confirmar() {
    const canvas = canvasRef.current
    canvas.toBlob(blob => {
      const reader = new FileReader()
      reader.onload = e => onConfirm(e.target.result) // dataURL base64 PNG, ya encuadrado
      reader.readAsDataURL(blob)
    }, 'image/png')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: '#1a1d27', borderRadius: 12, padding: 24, width: 'min(92vw, 560px)', border: '0.5px solid #2a2d3a' }}>
        <h3 style={{ color: 'white', fontSize: 15, marginBottom: 4 }}>Encuadrar firma</h3>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
          Arrastrá para mover y usá la rueda del mouse (o el control) para hacer zoom, hasta que la firma quede bien centrada dentro del recuadro.
        </p>

        <div
          style={{
            width: '100%', aspectRatio: `${OUT_W} / ${OUT_H}`, background: '#000',
            borderRadius: 8, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab',
            border: '1px solid #2a2d3a', touchAction: 'none'
          }}
          onWheel={handleWheel}
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
        >
          <canvas
            ref={canvasRef}
            width={OUT_W}
            height={OUT_H}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span style={{ color: '#888', fontSize: 11 }}>Zoom</span>
          <input
            type="range" min="0.05" max="5" step="0.01" value={zoom}
            onChange={e => setZoom(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel}
            style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#2a2d3a', color: 'white', border: 'none', fontSize: 13, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={confirmar}
            style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#1D9E75', color: 'white', border: 'none', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            Guardar firma
          </button>
        </div>
      </div>
    </div>
  )
}
