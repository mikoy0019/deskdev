import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Leaks';

registerRoot(sceneRoot('leaks', Scene));
