import logo from '../assets/logo.png'
import logoDark from '../assets/logo-dark.png'

export default function BrandLogo({ className = '' }) {
  return (
    <>
      <img src={logo} alt="Blaupunkt" className={`${className} dark:hidden`} />
      <img src={logoDark} alt="Blaupunkt" className={`hidden ${className} dark:block`} />
    </>
  )
}
