import { Redirect } from 'expo-router';
import { GalleryScreen } from '../sections/gallery';

export default function Gallery() {
  return __DEV__ ? <GalleryScreen /> : <Redirect href="/" />;
}
