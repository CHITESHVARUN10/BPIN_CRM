import mongoose from 'mongoose'

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: 'Others' },
  },
  { timestamps: true },
)

productSchema.index({ sku: 1, description: 1 }, { name: 'sku_desc_search' })

export default mongoose.model('Product', productSchema)
