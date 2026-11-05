export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse px-4 pt-6 md:px-6">
      <div className="h-56 rounded-[28px] bg-line-2" />
      <div className="mt-6 grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="aspect-square rounded-3xl bg-line-2" />
        ))}
      </div>
      <div className="mt-6 h-40 rounded-[28px] bg-line-2" />
    </div>
  )
}
