/**
 * Aurora's logo: an aurora over a skyline of sound-wave bars (same artwork as
 * the app icon). Small sizes use the simpler three-bar version, which stays
 * legible where the seven thin bars would blur together.
 */
export function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  const src = `${import.meta.env.BASE_URL}${size < 48 ? 'favicon.svg' : 'aurora-mark.svg'}`
  return <img className={`brand-mark ${className}`} src={src} width={size} height={size} alt="" draggable={false} />
}
