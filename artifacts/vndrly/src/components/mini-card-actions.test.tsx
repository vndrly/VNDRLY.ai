import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {PngPillButton,PngPillLink} from './png-pill-rollover';
import BrandPillButton from './brand-pill-button';
import SidebarButton from './sidebar-button';
vi.mock('@/hooks/use-brand',()=>({useBrand:()=>({primary:'#00adb5',name:'MidCon'})}));
it('uses the existing minicard style for shared legacy action buttons and links, with no pill artwork',()=>{
 const save=vi.fn();
 render(<><PngPillButton onClick={save} aria-pressed>Save</PngPillButton><PngPillButton disabled>Disabled action</PngPillButton><PngPillLink href='/record'>View record</PngPillLink><BrandPillButton>Confirm</BrandPillButton><SidebarButton shape='pill' isActive={false}>Toolbar action</SidebarButton></>);
 for(const name of ['Save','Disabled action','Confirm','Toolbar action']){
  const button=screen.getByRole('button',{name});expect(button.classList.contains('vendor-mini-card-button')).toBe(true);expect(button.style.borderRadius).toBe('8px');expect(button.querySelector('img')).toBeNull();
 }
 const link=screen.getByRole('link',{name:'View record'});expect(link.classList.contains('vendor-mini-card-button')).toBe(true);expect(link.style.borderRadius).toBe('8px');
 fireEvent.click(screen.getByRole('button',{name:'Save'}));expect(save).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:'Save'}).getAttribute('aria-pressed')).toBe('true');
 expect((screen.getByRole('button',{name:'Disabled action'}) as HTMLButtonElement).disabled).toBe(true);
});
