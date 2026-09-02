import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createField,
  getFields,
  getField,
  updateField,
  deleteField,
  restoreField,
} from '../controllers/fieldController.js';

const router = express.Router();

// All routes are protected (require authentication)
router.use(protect);

router.route('/')
  .get(getFields)
  .post(createField);

router.route('/:id')
  .get(getField)
  .put(updateField)
  .delete(deleteField);

router.patch('/:id/restore', restoreField);

export default router;
