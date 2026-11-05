import { AirVent, Bike, Car, Refrigerator, Smartphone, Wrench, type LucideProps } from 'lucide-react'

export function CategoryIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  switch (icon) {
    case 'mobile':
      return <Smartphone {...props} />
    case 'ac':
      return <AirVent {...props} />
    case 'bike':
      return <Bike {...props} />
    case 'fridge':
      return <Refrigerator {...props} />
    case 'car':
      return <Car {...props} />
    default:
      return <Wrench {...props} />
  }
}
