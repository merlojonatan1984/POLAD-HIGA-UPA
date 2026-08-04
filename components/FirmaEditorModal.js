import { useState, useRef, useEffect, useCallback } from 'react'

// Misma proporción que el recuadro de la planilla (160 x 49 = 3.265:1),
// pero renderizado a mayor resolución (x3) para que no se vea pixelado al imprimir.
const OUT_W = 480
const OUT_H = 147
// Tamaño real con el que la firma aparece en la planilla (en píxeles de pantalla, aprox.)
const REAL_W = 160
const REAL_H = 49

// Analiza la imagen y devuelve el recuadro (bounding box) donde está la tinta,
// ignorando el papel blanco de alrededor. Si no encuentra nada oscuro, devuelve null.
function detectarTinta(img) {
  const MAX_LADO = 500
  const escalaAnalisis = Math.min(1, MAX_LADO / Math.max(img.width, img.height))
  const aw = Math.max(1, Math.round(img.width * escalaAnalisis))
  const ah = Math.max(1, Math.round(img.height * escalaAnalisis))

  const c = document.createElement('canvas')
  c.width = aw
  c.height = ah
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, aw, ah)
  const { data } = ctx.getImageData(0, 0, aw, ah)

  const UMBRAL = 200
  let minX = aw, minY = ah, maxX = -1, maxY = -1

  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const i = (y * aw + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a < 10) continue
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      if (lum < UMBRAL) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null

  const bx = minX / escalaAnalisis
  const by = minY / escalaAnalisis
  const bw = (maxX - minX) / escalaAnalisis
  const bh = (maxY - minY) / escalaAnalisis

  return { x: bx, y: by, w: Math.max(bw, 1), h: Math.max(bh, 1) }
}

// Limpia el trazo: lo oscuro se vuelve negro sólido, lo claro se vuelve blanco puro,
// eliminando sombras de la foto y grises del papel. Así todas las firmas quedan
// parejas entre sí, como una firma escaneada, sin importar la foto original.
const BLANCO_DESDE = 215 // luminosidad a partir de la cual ya es "blanco puro"
const NEGRO_HASTA = 110  // luminosidad por debajo de la cual ya es "negro puro"

function limpiarTrazo(ctx, w, h) {
  const imgData = ctx.getImageData(0, 0, w, h)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    let out
    if (lum >= BLANCO_DESDE) out = 255
    else if (lum <= NEGRO_HASTA) out = 0
    else out = Math.round(((lum - NEGRO_HASTA) / (BLANCO_DESDE - NEGRO_HASTA)) * 255)
    d[i] = out; d[i + 1] = out; d[i + 2] = out
  }
  ctx.putImageData(imgData, 0, 0)
}

export default function FirmaEditorModal({ file, onCancel, onConfirm }) {
  const canvasRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const imgRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 })
  const [listo, setListo] = useState(false)
  const [sinDeteccion, setSinDeteccion] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const bbox = detectarTinta(img)

      if (bbox) {
        const PADDING = 0.18
        const padW = bbox.w * PADDING
        const padH = bbox.h * PADDING
        const bx = Math.max(0, bbox.x - padW)
        const by = Math.max(0, bbox.y - padH)
        const bw = Math.min(img.width - bx, bbox.w + padW * 2)
        const bh = Math.min(img.height - by, bbox.h + padH * 2)

        const escala = Math.min(OUT_W / bw, OUT_H / bh)
        setZoom(escala)
        const centroImgX = img.width / 2
        const centroImgY = img.height / 2
        const centroBoxX = bx + bw / 2
        const centroBoxY = by + bh / 2
        setOffset({
          x: (centroImgX - centroBoxX) * escala,
          y: (centroImgY - centroBoxY) * escala
        })
        setSinDeteccion(false)
      } else {
        const scaleParaCubrir = Math.max(OUT_W / img.width, OUT_H / img.height)
        setZoom(scaleParaCubrir)
        setOffset({ x: 0, y: 0 })
        setSinDeteccion(true)
      }

      setListo(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const dibujar = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return

    const w = img.width * zoom
    const h = img.height * zoom

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, OUT_W, OUT_H)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    const x = (OUT_W - w) / 2 + offset.x
    const y = (OUT_H - h) / 2 + offset.y
    ctx.drawImage(img, x, y, w, h)

    // Limpieza automática del trazo: pareja y prolija en todas las firmas
    limpiarTrazo(ctx, OUT_W, OUT_H)

    // Vista previa a tamaño real — se dibuja a partir del canvas YA procesado,
    // para que se vea exactamente lo que se va a guardar
    const preview = previewCanvasRef.current
    if (preview) {
      const ctx2 = preview.getContext('2d')
      ctx2.clearRect(0, 0, REAL_W, REAL_H)
      ctx2.drawImage(canvas, 0, 0, OUT_W, OUT_H, 0, 0, REAL_W, REAL_H)
    }
  }, [zoom, offset])

  useEffect(() => { if (listo) dibujar() }, [listo, dibujar])

  function handleWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    setZoom(z => Math.max(0.05, Math.min(z + delta, 8)))
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
      reader.onload = e => onConfirm(e.target.result)
      reader.readAsDataURL(blob)
    }, 'image/png')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: '#1a1d27', borderRadius: 12, padding: 24, width: 'min(92vw, 560px)', border: '0.5px solid #2a2d3a' }}>
        <h3 style={{ color: 'white', fontSize: 15, marginBottom: 4 }}>Firma</h3>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
          {sinDeteccion
            ? 'No pudimos detectar la firma automáticamente — arrastrá y hacé zoom para encuadrarla vos.'
            : 'La encuadramos y limpiamos automáticamente. Si no quedó perfecta, podés arrastrar o hacer zoom para ajustarla.'}
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
            type="range" min="0.05" max="8" step="0.01" value={zoom}
            onChange={e => setZoom(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '0.5px solid #2a2d3a' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>Así se va a ver en la planilla (tamaño real):</div>
          <div style={{
            display: 'inline-block', background: '#2a2d3a', padding: 10, borderRadius: 6
          }}>
            <canvas
              ref={previewCanvasRef}
              width={REAL_W}
              height={REAL_H}
              style={{ width: REAL_W, height: REAL_H, display: 'block', border: '1px solid #555' }}
            />
          </div>
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
