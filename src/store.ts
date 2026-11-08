import { create } from 'zustand';
import { temporal } from 'zundo';
export type Clip = { id:string; track:number; start:number; duration:number; name:string; color:string; brightness:number };
type State = { clips:Clip[]; playhead:number; playing:boolean; device:string; zoom:number; selected:string|null; set:(fn:(s:State)=>Partial<State>)=>void };
export const useDaw = create<State>()(temporal((set) => ({
 clips:[],
 playhead:0,playing:false,device:'NP2',zoom:1,selected:null,set:(fn)=>set(fn)
}), {
  partialize: (s) => ({ clips: s.clips } as State),
  equality: (previous, current) => previous.clips === current.clips,
  limit: 100,
}));
