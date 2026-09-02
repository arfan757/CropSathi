import mongoose from 'mongoose';

const fieldSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
    },
    name: {
      type: String,
      required: [true, 'Field name is required'],
      trim: true,
      maxlength: [100, 'Field name cannot exceed 100 characters'],
    },
    cropType: {
      type: String,
      required: [true, 'Crop type is required'],
      enum: ['Wheat', 'Rice', 'Maize', 'Cotton', 'Sugarcane', 'Potato', 'Grapes', 'Soybean', 'Tur', 'Other'],
    },
    cropStage: {
      type: String,
      enum: ['sowing', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested'],
      default: 'vegetative',
    },
    sowingDate: {
      type: Date,
      required: [true, 'Sowing date is required'],
    },
    polygon: {
      type: [{ lat: Number, lng: Number }],
      validate: {
        validator: function (v) {
          return v && v.length >= 3;
        },
        message: 'Polygon must have at least 3 points',
      },
    },
    boundary: {
      type: {
        type: String,
        enum: ['Polygon'],
        default: 'Polygon',
      },
      coordinates: {
        type: [[[Number]]],
      },
    },
    areaInHectares: {
      type: Number,
      default: 0,
    },
    areaInAcres: {
      type: Number,
      default: 0,
    },
    centerLat: {
      type: Number,
      default: null,
    },
    centerLng: {
      type: Number,
      default: null,
    },
    soilType: {
      type: String,
      enum: ['Alluvial', 'Black', 'Red', 'Laterite', 'Clayey', 'Sandy', 'Loamy', 'Other'],
      default: 'Other',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    lastWeatherPollAt: {
      type: Date,
      default: null,
    },
    lastRiskScoreAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Soft-delete: auto-exclude deleted docs from all queries ───────────────
// In Mongoose pre-hooks, `this` is the Query, first param is `next` callback.
function excludeSoftDeleted() {
  const opts = this.options || {};
  if (!opts.deletedAt) {
    this.where({ deletedAt: null });
  }
}

fieldSchema.pre('find', excludeSoftDeleted);
fieldSchema.pre('findOne', excludeSoftDeleted);
fieldSchema.pre('findById', excludeSoftDeleted);
fieldSchema.pre('count', excludeSoftDeleted);
fieldSchema.pre('countDocuments', excludeSoftDeleted);
// Note: findOneAndUpdate / findByIdAndUpdate are NOT hooked here.
// Controllers add deletedAt:null explicitly where needed, and restore needs to
// bypass soft-delete to find already-deleted docs.
fieldSchema.pre('aggregate', function () {
  this.pipeline().unshift({ $match: { deletedAt: null } });
});

// ─── Indexes ───────────────────────────────────────────────────────────────
fieldSchema.index({ userId: 1, deletedAt: 1 });
fieldSchema.index({ status: 1, deletedAt: 1 });

// ─── Calculate center + sync GeoJSON boundary before saving ────────────────
fieldSchema.pre('save', function (next) {
  // Compute centroid from polygon
  if (this.polygon && this.polygon.length > 0) {
    const sumLat = this.polygon.reduce((sum, p) => sum + p.lat, 0);
    const sumLng = this.polygon.reduce((sum, p) => sum + p.lng, 0);
    this.centerLat = sumLat / this.polygon.length;
    this.centerLng = sumLng / this.polygon.length;
  }

  // Auto-sync GeoJSON boundary from polygon if boundary not explicitly set
  if (this.polygon && this.polygon.length >= 3 && (!this.boundary || !this.boundary.coordinates)) {
    // GeoJSON Polygon: first ring must be closed (first == last point)
    const ring = this.polygon.map(p => [p.lng, p.lat]);
    ring.push(ring[0]); // close the ring
    this.boundary = {
      type: 'Polygon',
      coordinates: [ring],
    };
  }

  next();
});

const Field = mongoose.model('Field', fieldSchema);
export default Field;
