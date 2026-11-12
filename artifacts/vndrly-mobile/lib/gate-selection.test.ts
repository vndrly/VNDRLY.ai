import {renderHook,act} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import {useGateSelection,clearNativeGateSelections} from './gate-selection';
afterEach(clearNativeGateSelections);
it('retains browsing across mounted cards and navigation, isolated by membership',()=>{const a=renderHook(()=>useGateSelection({id:1},2)),b=renderHook(()=>useGateSelection({id:1},2)),other=renderHook(()=>useGateSelection({id:1},3));act(()=>a.result.current.save(4,'gate-4'));expect(b.result.current.selection).toEqual({siteId:4,stationId:'gate-4'});expect(other.result.current.selection).toBeNull();a.unmount();b.unmount();other.unmount();const returned=renderHook(()=>useGateSelection({id:1},2));expect(returned.result.current.selection?.stationId).toBe('gate-4');returned.unmount();});
it('clears browsing on workspace reset without restoring an old persistent key',()=>{const view=renderHook(()=>useGateSelection({id:2},2));act(()=>view.result.current.save(5,'gate-5'));act(clearNativeGateSelections);expect(view.result.current.selection).toBeNull();view.unmount();});
