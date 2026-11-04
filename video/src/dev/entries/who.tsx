import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Who';

registerRoot(sceneRoot('who', Scene));
