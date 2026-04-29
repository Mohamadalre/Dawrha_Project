import { diskStorage } from 'multer';
import { extname } from 'path';

export const logoMulterConfig = {
  storage: diskStorage({
    destination: './image/uploads/logos',
    filename: (req, file, cb) => {
      const uniqueName =
        Date.now() + '-' + Math.round(Math.random() * 1e9);

      cb(null, uniqueName + extname(file.originalname));
    },
  }),
};