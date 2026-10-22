import { Router } from 'express';
import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  createCaseEndpoint, uploadPhotosEndpoint, deleteCaseEndpoint,
  getCaseDetailEndpoint, listCasesEndpoint,
} from '../controllers/diagnosisController.js';

const router = Router();
router.use(protect);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_ROOT, 'cases', req.params.caseId || 'pending');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.]/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/cases', createCaseEndpoint);
router.get('/cases/:caseId', getCaseDetailEndpoint);
router.delete('/cases/:caseId', deleteCaseEndpoint);
router.post('/cases/:caseId/photos', upload.array('photos', 5), uploadPhotosEndpoint);
router.get('/farms/:farmId/cases', listCasesEndpoint);

export default router;