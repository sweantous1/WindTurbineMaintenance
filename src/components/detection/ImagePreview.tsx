interface ImagePreviewProps {
  src: string
  onRemove: () => void
}

export default function ImagePreview({ src, onRemove }: ImagePreviewProps) {
  return (
    <div className="relative group">
      <img
        src={src}
        alt="Turbine blade"
        className="w-full h-64 object-cover rounded-lg border border-gray-200"
      />
      <button
        onClick={onRemove}
        className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
