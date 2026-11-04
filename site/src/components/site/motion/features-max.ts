// Layout + drag features, loaded on demand (LazyMotion async bundle) by the
// primitives that need layout animations. Kept in its own module so the
// marketing pages that never reorder anything don't download it.
import { domMax } from 'framer-motion';

export default domMax;
