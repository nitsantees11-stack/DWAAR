export type CategoryIconKey = 'mobile' | 'ac' | 'bike' | 'fridge' | 'car'

/** Each section has its own accent; classes are defined in styles.css. */
export function themeClass(icon: string | null | undefined) {
  switch (icon) {
    case 'mobile':
      return 'theme-mobile'
    case 'ac':
      return 'theme-ac'
    case 'bike':
      return 'theme-bike'
    case 'fridge':
      return 'theme-fridge'
    case 'car':
      return 'theme-car'
    default:
      return 'theme-brand'
  }
}
