import dynamic from 'next/dynamic'

const ControlApp = dynamic(() => import('../components/ControlApp'), { ssr: false })

export default function Control() {
  return <ControlApp />
}
