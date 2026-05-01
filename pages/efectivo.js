import dynamic from 'next/dynamic'

const EfectivoApp = dynamic(() => import('../components/EfectivoApp'), { ssr: false })

export default function Efectivo() {
  return <EfectivoApp />
}
