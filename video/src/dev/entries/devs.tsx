import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Devs';

registerRoot(sceneRoot('devs', Scene));
