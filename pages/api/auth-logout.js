import { borrarCookieSesion } from '../../lib/authServer'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  borrarCookieSesion(res)
  return res.status(200).json({ ok: true })
}
